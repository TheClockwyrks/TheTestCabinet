// Meltdown — the shared validator harness. CASE-PROVIDED, over the shared harness.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THAT MACHINERY IS THE SHARED PACKAGE'S, NOT THIS CASE'S. The canvas and its
// draw-command recorder, the debug surface and the stand-in for a missing one, the
// apply-threaded driver, the driven frame, the sweep, the cue stamping, the pixel
// and text readings, and the evidence a review item's output is written from are
// the same job in every engine-backed case, so they live once in
// `@clockwyrks/case-harness`, staged beside this project at
// `validation/case-harness/`. The seam is one call: `createEngineCaseHarness`
// takes Meltdown's TYPES as type arguments and Meltdown's VALUES as one object —
// including the runtime itself, which arrives as values (`createEngine`,
// `ConstantClock`, the build's game), because the package names no engine — and
// hands that machinery back under this case's own names.
//
// WHAT IS GENUINELY MELTDOWN'S, AND THEREFORE STILL HERE. The two clocks the case
// chose ({@link TICK_HZ}, and the coarse {@link DRIVE_HZ} a check that spends
// minutes of game time runs on); the windows THE CLOCK RULE below prescribes and
// the real-time handover they are spent on; the readings over the snapshot; the
// case's own geometry; the readings over the picture that the package spells
// differently; and every compound sequence the checks share.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the runtime's frame counter, the cues the runtime broadcast, and —
// for the rendering checks — the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the floor through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `addTower` costs
// nothing and runs no placement check, `removeTower` pays no refund, a faculty
// gate stays off until something turns it back on, and `reset` gives everything
// back. Posing through it is how a scenario is arranged, and it is the seam
// the case's specification documents. `surface.ts` is that specification as types,
// and it is the only description of the surface this harness reads: the build's
// own module for it is never imported.
//
// THE ATOM AND THE ACT. The surface carries both, and the distinction is
// load-bearing. An ATOM poses one field with no side effect — `addTower`,
// `removeTower`, `setTowerLevel`, `removeUnit` — and is what a scenario is built
// from. An ACT is a single indivisible thing a player does, running through the
// game's own code with every consequence specs/building.md gives it — `place`,
// `upgradeTower`, `sellTower`. A check that merely wants a tower gone calls
// `removeTower`; a check about what selling does calls `sellTower`. No helper
// below reaches an act on the way to a scenario the act is not about.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the runtime
// holds the second element and returns it from `engine.debug`. Reading it back off
// the runtime is the only way a surface reaches a check, so a build that returned
// no surface, or a surface missing an operation, fails the checks that reach the
// game through it. The package's `readDebugSurface` does that read and stands an
// `absentSurface` in when there is nothing to read, so the fault lands on the
// points whose checks reach the game through the surface rather than on the
// `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN. The runtime holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setTowerHeat(id, 60)` and
// `h.debug.snapshot()`, because `h.debug` is the package's APPLY-THREADED driver
// over the raw surface: it runs each pose through `engine.apply` and hands each
// reading `engine.state`. Which members are readings cannot be told from the
// surface's shape at run time, so the driver is given `surface.ts`'s own
// `READINGS` list — the one the specification declares for exactly this reason.
// Nothing a check does holds a writable state — `h.state` is the runtime's current
// value, read fresh on every access, and the only way to change it is a pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 120 Hz tick and every duration below is a whole
// number of them. That is why `[instrumentation]` carries no `tick_hz`: Meltdown
// mandates no fixed timestep, every rate is per second and integrated against the
// delta the frame hands the game, and the SUITE is what fixes a step so a
// tolerance can be stated in ticks and mean the same thing on every machine. A
// check that is specifically about the step size — `heat.two-phase-resolution`
// takes one frame of `1/30` s — builds its own harness with a clock of its own.
//
// AND NOTHING HERE READS THE WALL CLOCK. Every frame a check spends is a frame
// it asked for, worth the milliseconds its clock answers, so the same frames land
// on any machine and a check measures the build rather than the host it ran on
// — see THE CLOCK RULE below.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  applyDriver,
  boundDrawLog,
  createEngineCaseHarness,
  rasterize,
  type EngineHarness,
  type EngineHarnessOptions,
  type PureDriver,
  type UntilOptions,
  type UntilResult as EngineUntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  sampleColor as sampleCluster,
  type EnginePointReader,
} from "./case-harness/engine/2d";
import { colorDistance, type Rgb } from "./case-harness/color";
import { drawnText, textDraws, type TextDraw } from "./case-harness/text";
import {
  IDENTITY,
  apply as applyMatrix,
  numbers,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import type { DrawCall } from "./case-harness/draw-calls";
import { BACKGROUND, game as build, type MeltdownState } from "../src/game";
import { fail } from "./assert";
import {
  BUILD_PHASE_TIME,
  DIFFICULTY_TABLE,
  LAYOUT,
  MODE_TABLE,
  STAGE_H,
  STAGE_W,
  TILE,
  TRIP_TIME,
  tileCX,
  tileCY,
} from "./constants";
import {
  footprintCentreOf,
  sizeOf,
  tileCentre,
  type Point,
  type Tile,
} from "./geometry";
import {
  READINGS,
  type BuildSnapshot,
  type ControlsSnapshot,
  type DifficultyName,
  type ExhaustName,
  type Face,
  type MeltdownDebugApi,
  type MeltdownSnapshot,
  type MenuRowSnapshot,
  type ModeName,
  type Phase,
  type RectSnapshot,
  type Screen,
  type ShopRectSnapshot,
  type SurgeType,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
  type VentName,
} from "./surface";

export type {
  BuildSnapshot,
  ControlsSnapshot,
  DifficultyName,
  ExhaustName,
  Face,
  MeltdownSnapshot,
  ModeName,
  Phase,
  Point,
  RectSnapshot,
  Screen,
  ShopRectSnapshot,
  SurgeType,
  Tile,
  TowerSnapshot,
  TowerType,
  UnitSnapshot,
  VentName,
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

/** The case's surface, bound to the state type the build declared. */
export type MeltdownSurface = MeltdownDebugApi<MeltdownState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<MeltdownState, MeltdownSurface>` here and the
 * runtime is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<MeltdownState, MeltdownSurface>;

/**
 * The surface as every check drives it: every member of the pure surface, minus
 * its state argument.
 *
 * The package's {@link PureDriver} mapping, over the two faces of this case's
 * state — the deep-readonly view the runtime hands out, and the value a pose
 * returns. A pose `(state, ...args) => MeltdownState` becomes `(...args) => void`
 * and a reading `(state) => R` becomes `() => R`; `version` is carried as it is,
 * which is what lets `instrumentation/surface-present` test an operation for
 * presence by `typeof`.
 */
export type MeltdownDriver = PureDriver<
  DeepReadonly<MeltdownState>,
  MeltdownState,
  MeltdownSurface
>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the runtime hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames,
 * so a tolerance can be stated in ticks and mean the same thing on every
 * machine.
 *
 * 120 Hz divides every figure this case is timed against finely enough to read a
 * threshold rather than a rounding: the wave spawner's `0.6` s cadence is 72
 * ticks, the trip's `5.0` s cooldown is 600, a `15` s build phase is 1800, and
 * the fastest emitter's `1 / 7` s fire interval is a shade over 17.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

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
// anywhere, and `instrumentation.render-free-core` is the point that grades
// that claim on its own. The suite's {@link TICK_HZ} is a convenience for
// stating tolerances in ticks, not a figure any specification fixes.
//
// AND THE COST OF DICING IT AT `120` Hz IS NOT SMALL. Under an engine every
// advanced frame is a real frame: the same `update` a player's frame runs
// followed by a real render into the canvas. A minute of game time at the
// suite's clock is seven thousand two hundred of them, and on a floor carrying
// dozens of units that is twenty to thirty seconds of one core — which on a
// runner sharing twenty cores between two hundred tasks is four to six minutes
// of WALL CLOCK, against a per-check ceiling. A point lost there is a point lost
// to the load on the machine, which is the one thing a validator must never
// measure.
//
// SO A LONG DRIVE RUNS AT `30` Hz. A frame of a thirtieth of a second is still
// eighteen frames inside one `WAVE_SPAWN_INTERVAL` (`0.6` s), a hundred and
// fifty inside a `TRIP_TIME` cooldown (`5` s), and four hundred and fifty inside
// a build phase (`15` s), so every period these points count is resolved many
// times over — and the drive costs a quarter of what it did. A check whose
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

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The most calls {@link Harness.calls} holds before the oldest are dropped.
 *
 * The list is what a rendering check reads, and a rendering check reads ONE
 * frame: the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading —
 * which is what {@link drawFrame} does. But the list is recorded whether a check
 * reads it or not, and this case's longest sweeps run tens of thousands of frames
 * of a floor drawing a 50x36 grid, a build panel and a roster of towers each, so
 * an uncapped list would be hundreds of megabytes in a check that never looks at
 * it. Past the cap the oldest half is dropped, which is far beyond any single
 * frame and so cannot cost a reading anything. The package's `boundDrawLog` is
 * what applies it, to the same array the recorder appends to.
 */
const MAX_RECORDED_CALLS = 200_000;

/**
 * How far a sweep runs when the caller names no bound of its own.
 *
 * The case's own figure rather than the package's `DEFAULT_MAX_FRAMES` (600),
 * which is half of it. Every sweep in this project names its own `maxFrames`
 * derived from the period it is watching, so nothing here rests on this — but
 * folding it into the package's would have quietly halved a bound a suite is
 * entitled to leave unstated, and that is exactly the kind of change nothing
 * would report.
 */
const SWEEP_LIMIT = 1200;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business: a build whose `initialize` REJECTED never
 * reaches it — the runtime's own rejection fails the suite's `beforeEach` with the
 * runtime's message, which is why every suite's `afterEach` disposes with `?.` —
 * and what is named here is the other fault, a return whose second element is no
 * surface at all.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

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
 * Everything a check reads off one runtime running one build, over and above the
 * package's neutral contract.
 *
 * The two that reach PAST it are this engine's own: the state the runtime holds
 * by value, and the pointer path spelled the way this project's suites spell it.
 */
interface StateModel {
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<MeltdownState>;
  /**
   * Report a pointer event to the RUNTIME's own pointer input, at a logical stage
   * position.
   *
   * The path a player's finger takes. The debug surface's `pointerDown`,
   * `pointerMove` and `pointerUp` resolve the same interaction at the call, which
   * is what a check about the interaction's RESULT uses; this is what a check
   * about a CUE uses, because a cue is raised by the frame that resolves the
   * event and no operation of the surface can play one.
   */
  point(type: "down" | "move" | "up", x: number, y: number): void;
}

/**
 * The package's engine machinery, bound to Meltdown on this runtime.
 *
 * Three of the config's members are where the four engines really differ, and
 * each is answered here from what THIS one is:
 *
 *  - `driver` is the APPLY-THREADED strategy, over `surface.ts`'s `READINGS`,
 *    because this runtime holds the state by value and the surface is pure.
 *  - `toLogical` is left at the identity: this runtime has no camera, so the
 *    case's logical stage units are the space the viewport maps.
 *  - `pointerPrecision` is `"device-pixel"`: a raised pointer lands on the same
 *    device pixel a reading would sample, which is what this project's checks
 *    have always been decided under. The event itself is the package's
 *    `PointerPositionEvent` — the client position and `isPrimary`, and nothing
 *    else — which is what this harness has always dispatched and what the
 *    runtime's pointer input reads.
 */
const kit = createEngineCaseHarness<
  MeltdownSnapshot,
  MeltdownDriver,
  Engine<MeltdownState, MeltdownSurface>,
  StateModel
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
    const engine = createEngine<MeltdownState, MeltdownSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the runtime exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    });
    return engine;
  },
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<MeltdownState>, MeltdownState, MeltdownDriver>(
      engine,
      raw,
      { readings: READINGS },
    ),
  snapshot: (debug) => debug.snapshot(),
  pointerPrecision: "device-pixel",
  extend: (base, engine) => ({
    get state() {
      return engine.state;
    },

    point: (type, x, y) => {
      base.pointer(`pointer${type}`, x, y);
    },

  }),
});

/** Everything a check reads off one runtime running one build. */
export type Harness = EngineHarness<
  MeltdownSnapshot,
  MeltdownDriver,
  Engine<MeltdownState, MeltdownSurface>
> &
  StateModel;

/** The window a harness reports to the runtime, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it; a check
 * that needs the exact elapsed time asserts against `seconds(ticksFor(d))` rather
 * than against `d`.
 */
export const ticksFor = kit.ticksFor;

/** A rate in units per second from a displacement measured over `ticks` frames. */
export const speedOverTicks = kit.speedOverTicks;

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options the kit passes the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the touch
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 *
 * Two things are bound here rather than in the config, because both are about the
 * harness the kit just built rather than about the case: the draw log is capped,
 * and the sweep is given this project's own bound to fall back on.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the runtime's own message rather than with a teardown error on top
 * of it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const h = await kit.createHarness(options);
  boundDrawLog(h.calls, MAX_RECORDED_CALLS);
  // Taken before it is replaced, so the wrapper below calls the kit's sweep and
  // not itself.
  const sweep = h.until.bind(h);
  Object.defineProperty(h, "until", {
    value: (
      predicate: (snapshot: MeltdownSnapshot) => boolean,
      sweepOptions: UntilOptions = {},
    ) =>
      sweep(predicate, {
        ...sweepOptions,
        maxFrames:
          sweepOptions.maxFrames ?? sweepOptions.maxTicks ?? SWEEP_LIMIT,
      }),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  return h;
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

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares its OUTPUTS beside its verdict: a `replay` — the frames
// the build itself drew while a check drove it, kept as evidence a reviewer can
// scrub against the reference implementation's — or an `image`, one frame of it.
// Both writers are the package's, bound here to this case's slug and to THIS
// directory, and four properties are what make them usable:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that poses a maze and then releases a wave against it records the
//    crossing; the pose costs nothing, and the reviewer is not asked to scrub past
//    a minute of arrangement to reach the seconds that decide the point. ARM IT
//    NARROWLY. A frame of this game redraws a 50x36 grid, the casing, every tower
//    and the whole build panel; the recorder holds 16 MB of captured image bytes
//    before new captures degrade to an opaque marker, so a recording armed around
//    a whole scenario buys a reviewer nothing and can cost the frames the check
//    was about.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario.

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
 * assertTrue(swept.hit);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export const captureReplay = makeReplayCapture("meltdown", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the maze a placement left behind, which
 * screen the game opened on, what the build panel read. A recording of a still
 * floor would be the same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in
// the check that makes them. What is here is the handful a check would otherwise
// write out every time: finding an entity by the id a pose handed back, and the
// panel rectangle a press is aimed at.
//
// EVERY LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id
// because a pose put an entity on the floor and the snapshot reported it; an id
// that is no longer there is the build having lost the entity, which is a verdict
// and not an absent value for the check to reason about. So these fail by
// assertion, naming what the surface promised, and the check reads the entity on
// the next line.

/** The tower with that id, or the failure that it is gone. */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const found = snapshot.towers.find((tower) => tower.id === id);
  if (found === undefined) {
    fail(
      `a tower with id ${id} in snapshot().towers, which an entity keeps for ` +
        `its whole life (specs/instrumentation.md, Identity)`,
      snapshot.towers.map((tower) => tower.id),
    );
  }
  return found;
}

/**
 * The tower a pose most recently appended.
 *
 * An entity added through the surface is appended to its roster, so it is the
 * last entry and its id is read from there (specs/instrumentation.md, Identity).
 */
export function lastTower(snapshot: MeltdownSnapshot): TowerSnapshot {
  const last = snapshot.towers[snapshot.towers.length - 1];
  if (last === undefined) {
    fail(
      "a tower appended to snapshot().towers by the pose that just ran " +
        "(specs/instrumentation.md, Identity)",
      "no towers on the floor",
    );
  }
  return last;
}

/** The surge unit with that id, or the failure that it is gone. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const found = snapshot.surge.find((unit) => unit.id === id);
  if (found === undefined) {
    fail(
      `a unit with id ${id} in snapshot().surge, which an entity keeps for ` +
        `its whole life (specs/instrumentation.md, Identity)`,
      snapshot.surge.map((unit) => unit.id),
    );
  }
  return found;
}

/** The surge unit a pose most recently appended. */
export function lastUnit(snapshot: MeltdownSnapshot): UnitSnapshot {
  const last = snapshot.surge[snapshot.surge.length - 1];
  if (last === undefined) {
    fail(
      "a unit appended to snapshot().surge by the pose that just ran " +
        "(specs/instrumentation.md, Identity)",
      "no units on the floor",
    );
  }
  return last;
}

/** Whether the floor still carries a tower with that id. */
export function hasTower(snapshot: MeltdownSnapshot, id: number): boolean {
  return snapshot.towers.some((tower) => tower.id === id);
}

/** Whether the floor still carries a unit with that id. */
export function hasUnit(snapshot: MeltdownSnapshot, id: number): boolean {
  return snapshot.surge.some((unit) => unit.id === id);
}

/** The centre of a panel control's reported hit rectangle. */
export function centreOf(rect: RectSnapshot): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The shop entry that arms `type`, or the failure that the panel has none. */
export function shopEntry(
  controls: ControlsSnapshot,
  type: TowerType,
): ShopRectSnapshot {
  const found = controls.shop.find((entry) => entry.type === type);
  if (found === undefined) {
    fail(
      `a shop entry for ${type} in snapshot().controls.shop, one per tower ` +
        `type in shop order (specs/hud.md)`,
      controls.shop.map((entry) => entry.type),
    );
  }
  return found;
}

/** The centre of a tower's footprint, from the tile it is anchored at. */
export function towerCentre(tower: TowerSnapshot): Point {
  return footprintCentreOf(tower.type, tower.col, tower.row);
}

/**
 * The distance from a tower's footprint centre to a point, in TILES — the
 * measure range is stated in (specs/combat.md).
 */
export function tileDistance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y) / TILE;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY: which tile a tower is anchored on, which
// vent a unit entered at, where a target stands. Every threshold a check asserts
// is stated in the check itself, derived from the figure specs/ fixes for it,
// because a helper that carried the tolerance would hide what the check is really
// asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs.
// Nothing a check does not ask for happens.

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

/** The waves a run on this pair fights (specs/modes.md). */
export function waveCountOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  return MODE_TABLE[mode].waveCount ?? DIFFICULTY_TABLE[difficulty].waves;
}

/**
 * Open live play on an EMPTY, QUIET floor: a `building` phase of wave 1, with the
 * run's own release of surge off.
 *
 * This is the ground almost every check in this suite stands on, and both halves
 * of it are load-bearing.
 *
 * EMPTY is safe because of the wave-clear rule: a wave clears on the transition in
 * which its last unit goes, so a phase that never released one never clears
 * (specs/waves.md). A check therefore poses exactly the entities its requirement
 * concerns and nothing else, rather than keeping a bystander unit alive to hold
 * the wave open.
 *
 * QUIET is the world gate. With `waveSpawning` off, the build timer's automatic
 * start of the next wave and the spawner's release of `wavePending` are both held,
 * so nothing the scenario did not ask for arrives — and the timer this helper
 * poses would otherwise run out mid-scenario and release a wave across whatever
 * the check was measuring.
 *
 * TURNING THE GATE BACK ON IS THE EXCEPTION, AND THE ITEM THAT DOES IT IS THE ITEM
 * WHOSE REQUIREMENT THE GATE IS — the two `instrumentation` gate items, the
 * `surge` release items, and the `waves` items about the opening phase, the
 * auto-start, the send and the clear. Any other check that finds itself needing it
 * has been mis-posed; re-pose it rather than turning it on.
 *
 * The money and the lives are the figures `specs/modes.md` derives for the pair,
 * read from the case's own seeded table rather than from the snapshot, so a build
 * that derives them wrongly fails the `modes` items alone and every other check
 * still stands on the floor it asked for.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 */
export function startRun(
  h: Harness,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setDifficulty(difficulty);

  h.debug.clearTowers();
  h.debug.clearSurge();

  h.debug.setScreen("playing");
  h.debug.setPhase("building");
  h.debug.setWave(1);
  h.debug.setBuildTimer(BUILD_PHASE_TIME);
  h.debug.setWavePending(0);
  h.debug.setWaveSpawning(false);

  h.debug.setMoney(startMoneyOf(mode, difficulty));
  h.debug.setLives(startLivesOf(mode));
  h.debug.setScore(0);

  h.debug.setSelected(null);
  h.debug.setHoverShop(null);
  h.debug.setArmed(null);
  h.debug.setSpeed(1);
}

/**
 * Pose one tower of `type`, footprint top-left at `(col, row)`, and report its id.
 *
 * The ATOM: `addTower` costs nothing, spends nothing and runs no placement check,
 * so a posed floor is never limited by the economy or by the build zone. It starts
 * at heat `0`, level `1`, not tripped, fresh, with both faculties on
 * (specs/instrumentation.md). A check about what PLACING does uses `setArmed`,
 * `setPreview` and `place` instead.
 */
export function poseTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number {
  h.debug.addTower(type, col, row, rotation);
  return lastTower(h.snapshot()).id;
}

/**
 * The thermal-scenario atom: one tower at `heat`, with its guns held.
 *
 * `setTowerFiring(id, false)` holds the targeting, the shot, its damage and the
 * `heatPerShot` it would add, and leaves the thermal model running exactly as an
 * idle tower's (specs/instrumentation.md). So what moves this tower's heat over a
 * window is air, conduction and the movers alone, which is what `thermal.ts`
 * computes.
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
 * The combat-scenario atom: one tower firing at a heat that cannot drift.
 *
 * `setTowerThermal(id, false)` pins the heat where it was posed while the tower
 * goes on acquiring targets, firing at its rate, and dealing its damage at that
 * heat (specs/instrumentation.md). So a damage figure a check reads is
 * `baseDamage * heatMultiplier(heat, redline)` at exactly the heat it asked for,
 * rather than at whatever the tower had cooled to by the time the shot landed.
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
 * The already-tripped atom: one tower offline on a trip, with `timer` seconds of
 * cooldown left.
 *
 * The trip is a CROSSING, not a value: a tower posed at `100` and cooling does not
 * trip (specs/heat.md). So every trip item except the one about the crossing
 * itself poses the tripped state directly rather than trying to manufacture it.
 */
export function poseTrippedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat = 100,
  timer = TRIP_TIME,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, timer);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A stationary, effectively unkillable target standing on tile `(col, row)`, and
 * its id.
 *
 * The combat-scenario counterpart to {@link posePinnedTower}: motion off so it
 * stays in range for the whole window, and an hp ceiling far past anything a
 * window of shots removes, so what a check reads is the DAMAGE DEALT rather than
 * the moment the target died. A check about a kill poses the hp the kill needs.
 *
 * It enters at the left vent, because a unit's vent is fixed by where it entered
 * and `addUnit` takes one; the position is then posed outright, and the vent only
 * decides which exhaust its route runs to.
 */
export function poseTarget(
  h: Harness,
  type: SurgeType,
  col: number,
  row: number,
  hp = 1e6,
  vent: VentName = "left",
): number {
  h.debug.addUnit(type, vent);
  const id = lastUnit(h.snapshot()).id;
  const at = tileCentre(col, row);
  h.debug.setUnitPosition(id, at.x, at.y);
  h.debug.setUnitMotion(id, false);
  h.debug.setUnitMaxHp(id, hp);
  h.debug.setUnitHp(id, hp);
  return id;
}

/**
 * One unit walking the floor from `vent`, exactly as the spawner released it, and
 * its id.
 *
 * Motion on, hp as the type and the current wave give it, its exhaust the fixed
 * opposite of the vent (specs/surge.md, specs/mazing.md).
 */
export function poseWalker(
  h: Harness,
  type: SurgeType,
  vent: VentName = "left",
): number {
  h.debug.addUnit(type, vent);
  return lastUnit(h.snapshot()).id;
}

/**
 * A run of `count` vent draws through `drawVent`, in order.
 *
 * Each is one independent draw and poses nothing (specs/instrumentation.md), so
 * a sampling check makes thousands of them in well under a second.
 */
export function drawVents(h: Harness, count: number): VentName[] {
  const out: VentName[] = [];
  for (let i = 0; i < count; i += 1) out.push(h.debug.drawVent());
  return out;
}

/**
 * Box a tower in: one tower of the named type against each face named, and their
 * ids by face.
 *
 * The thermal-blanket arrangement. An edge-tile facing another tower sheds nothing
 * to air (specs/heat.md), so a tower boxed on all four faces sheds nothing at all
 * and only the movers among its neighbours can move its heat. Naming fewer than
 * four faces boxes fewer than four.
 *
 * Each neighbour is centred on the face it covers, so its own faces do not reach
 * round the corner onto another neighbour's. THAT IS ONLY TRUE WHILE EVERY
 * NEIGHBOUR IS NO LARGER THAN THE TOWER IT BOXES: a bigger neighbour overhangs the
 * corner and abuts the neighbour on the next face, which would put a conduction
 * term in the scenario nobody asked for. This throws rather than posing that
 * floor, because it is a fault in the check and not a verdict about the build.
 */
export function boxIn(
  h: Harness,
  id: number,
  types: Partial<Record<Face, TowerType>>,
): Partial<Record<Face, number>> {
  const target = towerOf(h.snapshot(), id);
  const size = sizeOf(target.type);
  const placed: Partial<Record<Face, number>> = {};
  for (const [face, type] of Object.entries(types) as [Face, TowerType][]) {
    const side = sizeOf(type);
    if (side > size) {
      throw new Error(
        `meltdown harness.ts: boxIn cannot put a ${side}x${side} ${type} on ` +
          `the ${face} face of a ${size}x${size} ${target.type} without it ` +
          `abutting the neighbour on the next face; box it with a tower no ` +
          `larger than the one it boxes`,
      );
    }
    const along = Math.floor((size - side) / 2);
    const at =
      face === "N"
        ? { col: target.col + along, row: target.row - side }
        : face === "S"
          ? { col: target.col + along, row: target.row + size }
          : face === "W"
            ? { col: target.col - side, row: target.row + along }
            : { col: target.col + size, row: target.row + along };
    placed[face] = poseTower(h, type, at.col, at.row);
  }
  return placed;
}

/**
 * Hold every key in `codes` for `ticks` frames, then release them.
 *
 * Nothing here poses anything: the keys go to the engine's own input, so the
 * game answers them exactly as it answers a player. Which key drives which
 * action is `BINDINGS` in `constants.ts`, transcribed from specs/controls.md.
 */
export async function holdFor(
  h: Harness,
  codes: string | readonly string[],
  ticks: number,
): Promise<void> {
  const held = typeof codes === "string" ? [codes] : codes;
  for (const code of held) h.hold(code);
  try {
    await h.advance(ticks);
  } finally {
    for (const code of held) h.release(code);
  }
}

/**
 * Press and release the pointer at a logical stage position through the ENGINE's
 * own input, running the frames that deliver the samples.
 *
 * specs/controls.md resolves an interaction on the RELEASE, at the position the
 * release landed on, so the move and the press only carry the preview and the
 * hover. This is the path a player takes, which is why it is what a check about a
 * CUE uses: a cue is raised by the frame that resolves its event, and no operation
 * of the debug surface can play one (specs/instrumentation.md). A check about the
 * interaction's result alone may pose it instead, through
 * `h.debug.pointerDown`/`pointerUp`, which resolve at the call.
 */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  h.point("move", x, y);
  h.point("down", x, y);
  await h.advance(1);
  h.point("up", x, y);
  await h.advance(1);
}

/** Press and release a panel control, at the centre of the rectangle it reported. */
export function clickControl(h: Harness, rect: RectSnapshot): Promise<void> {
  const at = centreOf(rect);
  return clickAt(h, at.x, at.y);
}

/**
 * The rectangle the build reported for row `index` of the current screen's menu,
 * or the failure that it reported none.
 *
 * `specs/screens.md` requires every row of every menu to be a pointer target and
 * has the build report each row's rectangle, so a screen whose menu the build
 * drew but did not report cannot be driven with the pointer at all.
 */
export function menuRow(
  snapshot: MeltdownSnapshot,
  index: number,
): MenuRowSnapshot {
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
): Promise<MenuRowSnapshot> {
  const row = menuRow(h.debug.snapshot(), index);
  const at = centreOf(row);
  h.point("move", at.x, at.y);
  await h.advance(1);
  return row;
}

/** {@link clickAt} on the centre of a reported menu row. */
export async function clickMenuRow(h: Harness, index: number): Promise<void> {
  const at = centreOf(menuRow(h.debug.snapshot(), index));
  await clickAt(h, at.x, at.y);
}

/**
 * Run exactly one frame and hand back the calls THAT frame made.
 *
 * The reading every rendering check opens with. {@link Harness.calls} accumulates
 * across frames, so what a check about the picture wants is the frame it just
 * drove and not the setup before it.
 */
export async function drawFrame(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return [...h.calls];
}

/* ========================================================================== */
/* THE CLOCK RULE                                                             */
/* ========================================================================== */
//
// ANY CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// ACTUALLY RUNS ON, NEVER THROUGH A STEPPING OPERATION, BECAUSE THE STEPPING
// OPERATION IS INSTRUMENTATION AND THE QUESTION IS ABOUT THE GAME.
//
// The rule was bought with a defect. A previous version of this case decided
// "pausing freezes the floor" by pausing the game and then calling the debug
// API's own step. That measures WHERE A BUILD PUTS ITS PAUSE GATE, not whether
// the floor freezes. A build holding the pause in the shell that drives the clock
// is equally legal and stepped straight through the check while its real-time clip
// showed the unit stopping dead, so the verdict contradicted its own evidence. And
// worse in the other direction: a build whose pause menu opens over a floor that
// keeps running — the actual defect the item exists to catch — passed outright
// whenever the step happened to be gated.
//
// UNDER THIS ENGINE the rule has a specific and slightly happier reading, and it
// is worth being exact about it. `engine.advance(n)` is not an instrument bolted
// onto the game: it is the engine's OWN frame loop, running the identical `update`
// a player's frame runs, with a clock object that answers a different number of
// milliseconds. The build owns no loop it could gate separately — it owns
// `update` and nothing else — so there is no place for a pause to hide from
// `advance`. `advance` IS the player's clock here.
//
// So a pause check under `simple-2d` spends its windows with {@link overWindow}.
// What the rule still binds is the SHAPE of the measurement, and every part of it
// is load-bearing:
//
//   - TWO LEGS OF THE SAME LENGTH ON THE SAME UNIT. A running leg in which the
//     unit must travel, and a paused leg in which it must not. The running leg is
//     what stops a dead floor — a build that never moves anything — passing
//     vacuously.
//   - BOTH READINGS FROM THE ONE SNAPSHOT ON THE PRESS. The drift and the
//     simulated-clock gain come from the same pair of snapshots, so the pair spans
//     the paused window and nothing else. {@link overWindow} is built so the two
//     cannot disagree: it takes one snapshot at the call and one at the end.
//   - NON-ZERO TOLERANCES. The pause and the position are read a round trip apart,
//     and a build may legally resolve an injected key on its next frame rather
//     than inside the call.
//
// And one item is not about pausing at all but about the clock itself —
// `waves.game-runs-on-its-own-clock`, "the game advances by the elapsed time of
// every frame". It spends the same {@link overWindow}: the frames are the engine's
// own, each handed to the build worth the milliseconds the suite's clock answers,
// and the item reads whether that elapsed time reached the simulation. No window
// in this project is spent against the wall clock, so what a check reads is the
// same on any machine.
//
// The tolerances themselves are NOT here. They belong to the checks that assert
// them, derived from the figures the specs fix — a Mote covers 60 logical units a
// second (specs/surge.md), a build may clamp a long frame's delta, a handover may
// stall. A helper that carried them would hide what the check is really asserting.

/** A stretch of the game's own time, and the two readings that bracket it. */
export interface Window {
  /** The snapshot taken at the call, before a frame of the window ran. */
  before: MeltdownSnapshot;
  /** The snapshot taken once the window closed. */
  after: MeltdownSnapshot;
  /** Frames the window ran. */
  frames: number;
  /** The game time the simulation says it advanced by across the window. */
  clockGain: number;
  /** How far the unit with that id moved, in logical units. */
  travel(id: number): number;
  /** How much the heat of the tower with that id changed, signed. */
  heatChange(id: number): number;
}

/** Assemble a window's readings from the pair of snapshots that bracket it. */
function windowOf(
  before: MeltdownSnapshot,
  after: MeltdownSnapshot,
  frames: number,
): Window {
  return {
    before,
    after,
    frames,
    clockGain: after.simTime - before.simTime,
    travel(id) {
      const from = unitOf(before, id);
      const to = unitOf(after, id);
      return Math.hypot(to.x - from.x, to.y - from.y);
    },
    heatChange(id) {
      return towerOf(after, id).heat - towerOf(before, id).heat;
    },
  };
}

/**
 * Spend `frames` frames of the build's own clock, bracketed by ONE snapshot at
 * the call and ONE when it closes.
 *
 * The measurement THE CLOCK RULE above prescribes. Call it immediately after the
 * press whose effect is being measured, so the pair spans the window that press
 * opened and nothing else, and give both legs of a comparison the same `frames`.
 */
export async function overWindow(h: Harness, frames: number): Promise<Window> {
  const before = h.snapshot();
  await h.advance(frames);
  return windowOf(before, h.snapshot(), frames);
}

/* ========================================================================== */
/* What the build drew, and what it played                                    */
/* ========================================================================== */
//
// The presentation and audio halves of this suite need three things the scenario
// helpers above do not provide: a cue record stamped with the frame each cue fired
// on, a colour sampler over the rendered canvas, and a way to ask what a single
// frame's render put where. THE PALETTE IS THE BUILD'S — specs/overview.md fixes
// no colour and no typeface, only what a player must be able to tell apart — so
// nothing here knows a colour: the samplers compare what was painted against what
// else was painted.
//
// MOST OF THE MACHINERY IS THE PACKAGE'S. What stays here is the three readings
// whose NAME means something different in this project than it does there, and
// the two the package has no counterpart for. Each says which it is.

/* ---- Cues ----------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The runtime publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which is what tells a build that plays a cue on the right event apart
 * from one that plays it on every frame, or a frame late.
 *
 * A LOOP IS NOT A PLAY, and this project counts firings, so the kit is left at its
 * default subscription of `cue:played` alone. The cue NAMES are `CUES` in
 * `constants.ts`, transcribed from specs/audio.md, which says which event each one
 * belongs to.
 */
export const watchCues = kit.watchCues;

/* ---- Text ----------------------------------------------------------------- */

/**
 * Every string the frame drew, through `fillText` or `strokeText`.
 *
 * The package's reading, which answers the RAW strings one entry per call. The
 * merged-run reading beside it in the package (`drawnTextLines`) answers a
 * different question and is not what this project's checks were decided under.
 */
export { drawnText };

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the exact
 * run would fail a screen that shows precisely the right words.
 *
 * A DIFFERENT QUESTION FROM THE PACKAGE'S `drewText`, which asks the same of a
 * LOGICAL RUN — the coalesced run a build drew a glyph at a time. This one asks it
 * of the RAW draws, which is what every point in this project was decided under: a
 * build that draws `PAUSED` one letter per `fillText` spells nothing this reading
 * matches, and the two answers differ wherever a build letter-spaces its copy. So
 * it stays here under its own name rather than folding into the package's.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * One run of text a frame drew, and the logical x range its glyphs span.
 *
 * The package's `TextDraw`, under this project's own name. It carries the
 * alignment in force at the draw as well, which nothing here reads.
 */
export type TextSpan = TextDraw;

/**
 * Every run of text `calls` drew, placed in logical units.
 *
 * A build may anchor its text through any `translate`/`scale` it likes and align
 * it any way it likes, so the anchor is mapped through the transform the context
 * held at the call and the run is extended about it by its measured width and
 * `textAlign`. Which way a `start`/`end` alignment reads is the page's direction;
 * this game draws no right-to-left text, so they are left and right.
 *
 * ONE ENTRY PER CALL — the package's `textDraws` rather than its `drawnTextRuns`,
 * which coalesces the draws of one logical run into a single wider entry. This
 * project's checks read each draw's own extent, so the per-call reading is the one
 * they were decided under. `allInLogical` is the second half: the package's text
 * readings answer in CANVAS pixels, because that is where the calls were made, and
 * this maps them back through the runtime's own fit into the logical units every
 * check states its expectations in.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(calls));
}

/* ---- Where a frame put its rectangles -------------------------------------- */

/** One rectangle a frame drew, placed in logical units. */
export interface DrawnRect {
  /** `fillRect`, `strokeRect` or `clearRect`. */
  method: string;
  /** The rectangle's edges, in logical units, left/top always the smaller. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Its centre, in logical units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three rectangle calls {@link drawnRects} places. */
const RECT_METHODS = new Set(["fillRect", "strokeRect", "clearRect"]);

/**
 * The transform in force at each recorded call, indexed exactly as `calls` is.
 *
 * A build draws under whatever `translate`/`scale`/`rotate` it likes, and the
 * runtime's own fit is a `setTransform` at the head of every frame, so the
 * arguments a drawing call carries say nothing about where it landed until the
 * transform in force at it is applied. This is the walk that carries that
 * state — the frame's operations, through `save`/`restore` and every transform
 * call the package's `transformed` knows — and it answers one matrix per entry so
 * a reader that needs the INDEX of a call as well as its geometry keeps both.
 *
 * THE PACKAGE HAS NO COUNTERPART. Its own readings — `drawnPoints`, `textDraws`,
 * `imageDraws` — each make this walk privately and answer their own shape, and
 * what this project needs is the state itself: `presentation/text-legible` finds
 * the LAST call that washed the whole stage and reads only the text drawn after
 * it, which is a question about a call's position in the list rather than about
 * its geometry.
 *
 * Reading the transform off the recorded operations is exact for this game,
 * because every transform in a frame is one the recorder saw: the runtime's own
 * `setTransform` for the fit, and whatever the build issued.
 */
export function transformsInForce(calls: readonly DrawCall[]): Matrix[] {
  const inForce: Matrix[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind === "call") {
      if (call.method === "save") {
        stack.push(current);
      } else if (call.method === "restore") {
        current = stack.pop() ?? IDENTITY;
      } else {
        current = transformed(current, call.method, call.args) ?? current;
      }
    }
    inForce.push(current);
  }
  return inForce;
}

/**
 * Every `fillRect`, `strokeRect` and `clearRect` in `calls`, mapped into logical
 * units.
 *
 * A build draws a tower by translating to its footprint centre and drawing about
 * the origin, so the call's own arguments say nothing about where the rectangle
 * landed: the corners are taken through the transform in force at the call and
 * then back through the runtime's fit. Which is how a draw is attributed to the
 * tile, the footprint or the panel strip it was drawn for.
 *
 * A rotated transform is reported as the axis-aligned box its corners span, which
 * is what a check asking "did anything get drawn over this tile" wants.
 *
 * THE PACKAGE HAS NO COUNTERPART, so this stays with the case, over
 * {@link transformsInForce}.
 */
export function drawnRects(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnRect[] {
  const view = h.viewport();
  const inForce = transformsInForce(calls);
  const drawn: DrawnRect[] = [];
  for (const [index, call] of calls.entries()) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (!RECT_METHODS.has(method)) continue;
    const rect = numbers(args, 4);
    if (rect === null) continue;
    const current = inForce[index] as Matrix;
    const [rx, ry, rw, rh] = rect;
    const corners: readonly (readonly [number, number])[] = [
      [rx, ry],
      [rx + rw, ry],
      [rx, ry + rh],
      [rx + rw, ry + rh],
    ];
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [cx, cy] of corners) {
      const at = applyMatrix(current, cx, cy);
      xs.push((at.x - view.offsetX) / view.scale);
      ys.push((at.y - view.offsetY) / view.scale);
    }
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    drawn.push({
      method,
      left,
      top,
      right,
      bottom,
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      w: right - left,
      h: bottom - top,
    });
  }
  return drawn;
}

/* ---- Colour --------------------------------------------------------------- */

/**
 * How far out on the axes {@link sampleColor} takes its four neighbours.
 *
 * Three logical units, which on a `19`-unit tile all stay well inside it, so one
 * stray anti-aliased or grid-line pixel cannot swing the reading. The package's
 * own default is four, which is a fact about the cases it was lifted from rather
 * than about this game's tiles, so the figure is named here and passed.
 */
const SAMPLE_RADIUS = 3;

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours {@link SAMPLE_RADIUS} units out on the
 * axes. The package's five-point cluster, at this case's own radius.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleCluster(h as EnginePointReader, x, y, SAMPLE_RADIUS);
}

/** The rendered colour on tile `(col, row)`, sampled about its centre. */
export function sampleTile(h: Harness, col: number, row: number): Rgb {
  return sampleColor(h, tileCX(col), tileCY(row));
}

/**
 * `steps` colours sampled evenly along the segment joining two logical points,
 * both ends included.
 *
 * How a check reads whether the build drew something ALONG a line — a casing band,
 * a health bar, a range ring — without knowing what colour it drew it in.
 */
export function samplesAlong(
  h: Harness,
  from: Point,
  to: Point,
  steps: number,
): Rgb[] {
  const samples: Rgb[] = [];
  const last = Math.max(1, steps - 1);
  for (let i = 0; i < steps; i += 1) {
    const t = i / last;
    samples.push(
      sampleColor(
        h,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      ),
    );
  }
  return samples;
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the runtime clears the
 * whole canvas to each frame (specs/overview.md), read back through the same
 * canvas implementation the harness samples with, so a pixel the game never drew
 * over compares against it exactly.
 *
 * The package's `rasterize` repeats the fill rather than applying it once, so a
 * translucent colour reads as the runtime leaves it: the runtime composites its
 * clear over the previous frame every frame, which converges on the colour's own
 * channels, and a single fill over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterize(BACKGROUND);
  return { r, g, b };
}
