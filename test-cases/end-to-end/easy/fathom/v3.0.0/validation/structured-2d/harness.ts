// Fathom — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT FATHOM'S. Building the canvas and the
// recorder over it, standing the engine up on it, reading the debug surface back
// off it and standing something in when the build returned none, the frame sweep,
// the key and pointer events, the cue stamping, the pixel readings, and the
// evidence a review point declares — every engine-backed case needs exactly that,
// and it lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Fathom's: the shape of
// its surface, the tick it counts in, the scenarios it poses, and the readings a
// trench of dark water and small amber lights is made of.
//
// The seam is one call. `createEngineCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object — including the ENGINE itself,
// which the package names nowhere and cannot — and hands back the machinery with
// Fathom's names and Fathom's types on it, so the 158 suites next door go on
// importing `createHarness`, `captureReplay` and `startPlaying` from `../harness`
// exactly as they did.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state, its
// game instance — the engine's frame counter, the events the engine broadcast,
// and — for the rendering checks — the pixels on the canvas or the calls the 2D
// context received. Nothing here fabricates an outcome: the scenario helpers
// below and the fixtures in `fixtures.ts` only ARRANGE the game through the debug
// surface, and the real ticks the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `setMaze`
// sets the layout and nothing else, `clearPredators` empties the roster,
// `setPredatorMind(index, false)` holds one hunter exactly where it stands.
// Posing through it is how a scenario is arranged, and it is the seam the
// case's specification documents. `surface.ts` is that specification as types, and
// it is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check. The
// package's `readDebugSurface` does that read and stands an `absentSurface` in
// when there is nothing to read, so a build that returned no surface fails the
// points whose checks reach the game through it rather than the `beforeEach` that
// built the harness. {@link SURFACE_REQUIREMENT} is the sentence such a failure
// names, and it is the case's because where the surface comes from is this
// engine's business.
//
// HOW THE SURFACE IS DRIVEN — the IDENTITY strategy, which is what a structured
// engine's state model allows. Each operation is a method that acts on the live
// game at the moment of the call, so a pose is `h.debug.setScreen(s)` and a
// reading is `h.debug.snapshot()`, with nothing in between: the object the build
// returned IS the driver. Fathom runs in ONE world for the whole session and
// every screen is a value of `screen`, so no pose rides a level transition and a
// reading taken straight after a pose sees it.
//
// THE CLOCK. A constant `TICK_MS` step is the default, so one advanced frame is
// exactly one `TICK_DT` tick of the fixed-step core specs/movement.md fixes, and
// every duration below is a whole number of them. That is the unit a tolerance is
// stated in. {@link Harness.skip} is the one exception, and it is why the default
// clock is this file's own {@link StepClock} rather than the engine's
// `ConstantClock`: a march run off camera hands the engine several ticks' worth of
// delta at a time and draws once, which specs/movement.md makes the same
// simulation. A check that is specifically about the step size
// (`controls/advances-in-real-time`) builds harnesses with clocks of its own.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
  brightestIn,
  colorDistance,
  gridPoints,
  meanChannel,
  rgbOf,
  type NearSample,
  type Rgb,
} from "./case-harness/color";
import { callsTo, setsOf, type DrawCall } from "./case-harness/draw-calls";
import {
  createEngineCaseHarness,
  identityDriver,
  type AssetFailure,
  type EngineHarness,
  type EngineHarnessOptions,
  type EngineViewport,
  type PointerEventType,
  type TimedCue,
  type UntilOptions as BaseUntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/engine/index";
import {
  makeReplayCapture,
  sampleColor as clusterColor,
  sampleRing as ringColor,
} from "./case-harness/engine/2d";
import { BACKGROUND, game as build } from "../src/game";
import { assertTruthy } from "./assert";
import { BINDINGS, LAYOUT, STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import { tileCenter, type Dir, type GridFrame, type Tile } from "./maze";
import type {
  FathomDebugApi,
  FathomSnapshot,
  MenuRect,
  PredatorSnapshot,
} from "./surface";

export type { Dir, Tile, GridFrame };

/* The readings this project takes straight off the package, under its names. */
export type { AssetFailure, DrawCall, NearSample, Rgb, TimedCue };
export { callsTo, setsOf };

/** One cue the build played, as the engine announced it. */
export type PlayedCue = TimedCue;

/** The case's surface, exactly as `surface.ts` specifies it. */
export type FathomSurface = FathomDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain data —
 * so no wrapper stands between a check and the object the build returned, and the
 * driver type is the surface type itself. The alias is kept so a check reads the
 * same way it does under an engine whose surface needs driving.
 */
export type FathomDriver = FathomSurface;

/** The engine this project stands a build up on. */
export type FathomEngine = Engine<FathomSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<FathomSurface>` here and the engine is parameterized with it. A
 * surface that departs from the specification is caught where a check reaches for
 * the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<FathomSurface>;

/* -------------------------------------------------------------------------- */
/* The tick                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One frame of the default clock, in milliseconds.
 *
 * `TICK_HZ` is the case's own, from `./constants` and never off the build:
 * unlike a case that leaves its timestep to the frame, specs/movement.md fixes
 * Fathom's core at `120` steps a second and integrates every rate in whole ticks
 * of it. Running the clock at exactly that rate makes one advanced frame one
 * simulation tick, so a duration is a whole number of frames and a tolerance
 * stated in ticks means the same thing on every machine.
 */
export const TICK_MS = 1000 / TICK_HZ;

export { TICK_HZ };

/**
 * The exact number of ticks in `seconds` of game time, for turning one of the
 * seconds-valued figures the specs fix into something `advance` can take:
 * `ticksFor(SONAR_COOLDOWN)` is `180`, `ticksFor(INK_COOLDOWN)` is `960`.
 *
 * It THROWS rather than rounding when the duration is not a whole number of
 * ticks. A rounded step silently moves the simulation a different distance than
 * the caller asked for, so a duration that does not land on a tick boundary is a
 * decision for the check to make deliberately: pick the whole tick count that
 * preserves what the check is probing and pass it directly, saying why.
 *
 * FATHOM'S OWN, AND NOT THE PACKAGE'S `ticksFor`, which is a spelling of `ticks`
 * and ROUNDS UP. The two agree on every duration that lands on a tick boundary
 * and disagree on exactly the durations this one exists to refuse, so binding the
 * package's would turn a refusal into a silently shortened march.
 */
export function ticksFor(duration: number): number {
  const ticks = duration * TICK_HZ;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(
      `ticksFor(${duration}): ${duration}s is ${ticks} ticks, not a whole ` +
        `non-negative number of simulation ticks — choose the tick count ` +
        `deliberately and pass it directly`,
    );
  }
  return ticks;
}

/* -------------------------------------------------------------------------- */
/* The keyboard                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The first key each movement action is bound to, from the case's own
 * `BINDINGS` in `./constants`.
 *
 * A check about ONE binding names that binding itself (`"KeyW"`,
 * `"ArrowLeft"`); this is for the scenarios that need the forager traveling in a
 * direction and do not care which of the two keys does it.
 */
export const DIR_KEY: Readonly<Record<Dir, string>> = {
  up: BINDINGS.up[0],
  down: BINDINGS.down[0],
  left: BINDINGS.left[0],
  right: BINDINGS.right[0],
};

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business — the instance's own return — and a fault
 * that misdescribed it would send a reviewer to the wrong line of the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which the " +
  "engine hands back from engine.debug (specs/instrumentation.md)";

/* -------------------------------------------------------------------------- */
/* The clock a march is run off camera on                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ticks a {@link Harness.skip} spends in one frame.
 *
 * Half a second of game time. specs/movement.md has the simulation advance "the
 * whole `TICK_DT` ticks that delta completes", so a frame this long runs sixty
 * real ticks and draws once — which is what makes a march of a minute cost the
 * wall clock a fraction of a second rather than tens of them.
 */
const COAST_TICKS = 60;

/**
 * The default clock, whose step {@link Harness.skip} retunes for the length of a
 * march and puts back.
 *
 * It is a constant clock in every respect a check can observe — it ignores the
 * host timestamp and reports the step it was built with — and the only reason
 * it is not the engine's own `ConstantClock` is that `skip` has to reach in and
 * change that step.
 */
class StepClock implements Clock {
  constructor(public ms: number) {}

  delta(): number {
    return this.ms;
  }
}

/**
 * The {@link StepClock} each engine was built on, or nothing where the check
 * supplied a clock of its own.
 *
 * `skip` retunes the clock the harness is actually running, so it has to reach
 * the object the factory was handed rather than a fresh one — and the factory is
 * the one place both the clock and the engine it went into are in hand. A weak
 * map, so a disposed harness's entry goes with it, and keyed by the engine
 * because that is what `extend` is given.
 */
const stepClocks = new WeakMap<object, StepClock>();

/* -------------------------------------------------------------------------- */
/* The pointer                                                                */
/* -------------------------------------------------------------------------- */

/** The devices a menu gesture is driven by (specs/ui.md). */
export type PointerDeviceName = "mouse" | "touch";

/** The bit `PointerEvent.buttons` gives the primary button. */
const PRIMARY_BUTTON_BIT = 1;

/** The index `PointerEvent.button` gives the primary button. */
const PRIMARY_BUTTON = 0;

/** What `PointerEvent.button` carries on an event about position alone. */
const NO_BUTTON = -1;

/** The pointer id each device drives under: one mouse, one finger. */
const POINTER_ID: Readonly<Record<PointerDeviceName, number>> = {
  mouse: 1,
  touch: 2,
};

/** Exactly the fields the engine's pointer listeners read off an event. */
interface PointerEventFields {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: PointerDeviceName;
  isPrimary: boolean;
  /** The button the event is ABOUT, as `PointerEvent.button` numbers them. */
  button: number;
  /** Every button held once the event has been applied, as a bit mask. */
  buttons: number;
}

/**
 * A `PointerEvent`-shaped event, carrying the seven fields the engine reads and
 * nothing else.
 *
 * FATHOM'S OWN, AND NOT EITHER OF THE PACKAGE'S TWO. A `DevicePointerEvent`
 * reports the primary button held on every move, which is what a browser sends
 * during a DRAG and not what it sends when the pointer is merely travelling; a
 * `PointerPositionEvent` names no device at all, and specs/ui.md gives a touch
 * contact a rule of its own. This one reports the mask that is really HELD — set
 * by the gesture helpers below as a press adds one and a release drops one — and
 * gives the finger a pointer id of its own, which is the pair the menu points
 * were decided under.
 *
 * A shim rather than a real `PointerEvent`: this suite runs over a canvas with no
 * document behind it, so there is no `PointerEvent` constructor to call and no
 * element to dispatch from. The engine narrows structurally — it reads `clientX`,
 * `clientY`, `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off
 * whatever arrives — so an event carrying those drives the pointer exactly as a
 * player's does.
 */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDeviceName;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(type: PointerEventType, fields: PointerEventFields) {
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
 * Where a logical stage point lands in the CSS pixels a pointer event reports.
 *
 * The inverse of the engine's own placement: it takes `clientX`/`clientY`
 * through the device pixel ratio and the letterboxed fit to reach a logical
 * point, so a check aiming a gesture at a logical point goes the other way.
 *
 * THE CAMERA IS NOT IN THIS PATH, and deliberately: the engine's pointer input
 * reports a LOGICAL point to the game and the game projects it itself, so a
 * gesture aimed at a logical point goes back out through the fit alone. A PIXEL
 * reading does go through the camera — see the kit's `toLogical` below — because
 * a pixel is addressed in the world the camera is looking at.
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

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** How far a sweep may run, and how many ticks separate two samples. */
export type UntilOptions = BaseUntilOptions;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<FathomSnapshot>;

/** Everything this harness carries past the package's neutral contract. */
export interface FathomModel {
  /**
   * The world currently open, read fresh on every access. Fathom opens one world
   * for the whole session, so this is the same world throughout a check; it is a
   * getter so a build that does open another is still read correctly.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. Its arrangement is
   * the build's (specs/state.md), which is why every figure a check reads comes
   * through `snapshot()` instead.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<FathomSurface>;
  /**
   * Run `ticks` that cost a captured section nothing, for setup rather than for
   * measurement — and run them in as few frames as the fixed-step core allows.
   *
   * WHY THIS IS NOT `advance`. `advance` steps FRAMES, and a frame of this
   * harness's clock is worth one tick, so a march measured in minutes of game
   * time is a march measured in tens of thousands of RENDERS — which is what a
   * long setup actually costs, the simulation itself being the cheap half.
   * specs/movement.md fixes the core so that "the number of ticks run over an
   * interval of game time is the same however that interval was divided into
   * frames", so this hands the engine {@link COAST_TICKS} ticks' worth of delta
   * at a time and the game runs every one of those ticks through its own
   * `TICK_DT` loop. The ticks are real, in order, and identical to the ones
   * `advance` would have run; what is spared is the drawing between them.
   *
   * A section under a `captureReplay` is a section being measured or recorded,
   * and neither is what this is for: it records nothing and, spending several
   * ticks a frame, it reports nothing about WHEN inside the march anything
   * happened. A check reading a moment steps it with `advance`.
   *
   * A harness built with a clock of its own falls back to `advance`, because the
   * step it hands the engine is that clock's to decide.
   */
  skip(ticks: number): Promise<void>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;
  /**
   * Move the pointer to a logical stage point, and run the frame that reads it.
   *
   * `device` is what separates a finger from a mouse: specs/ui.md gives a touch
   * contact a rule of its own — a landing selects, because a finger does not
   * hover — so a check about touch drives `"touch"` and the engine reports the
   * contact to the game as one.
   */
  movePointer(x: number, y: number, device?: PointerDeviceName): Promise<void>;
  /** Press the pointer at a logical stage point, and run the frame that reads it. */
  pressPointer(x: number, y: number, device?: PointerDeviceName): Promise<void>;
  /** Release the pointer at a logical stage point, and run the frame that reads it. */
  releasePointer(
    x: number,
    y: number,
    device?: PointerDeviceName,
  ): Promise<void>;
}

/**
 * Everything a check reads off one engine running one build.
 *
 * It satisfies `fixtures.ts`'s `FixtureHost` and `scene.ts`'s `SceneHost`
 * structurally — a `debug`, a `snapshot`, an `advance` and a `skip` — which is
 * what lets those two files be byte-identical in every engine directory and know
 * nothing about any engine.
 */
export type Harness = EngineHarness<
  FathomSnapshot,
  FathomDriver,
  FathomEngine
> &
  FathomModel;

/** The directory this file sits in, which is the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The package's engine machinery, bound to Fathom on this engine.
 *
 * Four of the config's members are where the engines differ, and each is answered
 * here from what THIS engine is:
 *
 *  - `driver` is the IDENTITY strategy: this engine's surface is already
 *    imperative, so the object the build returned is what a check calls.
 *  - `toLogical` goes through the open world's camera, because a PIXEL is
 *    addressed in the world the camera is looking at. It opens at the defaults —
 *    world and logical coordinates coincide, which is the space every figure in
 *    `./constants` is stated in — so the projection is the identity unless the
 *    build moved it, and mapping through it keeps the reading honest either way.
 *  - `pointerPrecision` stays `"exact"`, so a raised pointer lands exactly where
 *    the caller asked rather than on the nearest device pixel.
 *  - `pointerEvent` is this case's own {@link PointerEventShim}, so the kit's own
 *    one-shot `pointer` raises the same event the gesture helpers below do. The
 *    helpers are what a check uses, because only they carry a mask across a drag.
 */
const kit = createEngineCaseHarness<
  FathomSnapshot,
  FathomDriver,
  FathomEngine,
  FathomModel
>({
  slug: "fathom",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // Every text call carries the width it was measured at and the transform in
  // force, because five points read a run of text as a PLACE rather than as a
  // word: `instrumentation/menu-rect` holds a reported region against the point
  // an item was drawn at, and the `hud/*` points hold each readout inside the
  // strip specs/ui.md gives it. See `text.ts`, which is that reading.
  recorder: { measureText: true },
  defaultClock: () => new StepClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    const engine = createEngine<FathomSurface>({
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
    if (clock instanceof StepClock) stepClocks.set(engine, clock);
    return engine;
  },
  driver: (_engine, raw) => identityDriver(raw as FathomSurface),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerEvent: (type, clientX, clientY, device) =>
    new PointerEventShim(type, {
      clientX,
      clientY,
      pointerId: POINTER_ID[(device ?? "mouse") as PointerDeviceName],
      pointerType: (device ?? "mouse") as PointerDeviceName,
      isPrimary: true,
      // A lone gesture holds nothing before it and nothing after it, so the mask
      // is the one a press leaves and a move or a release does not.
      button: type === "pointermove" ? NO_BUTTON : PRIMARY_BUTTON,
      buttons: type === "pointerdown" ? PRIMARY_BUTTON_BIT : 0,
    }),
  extend: (base, engine, initialized) => {
    /**
     * The buttons the driven pointer holds, kept as a browser keeps them: a press
     * adds one, a release drops one, and every event reports the set as it stands
     * once the event has been applied. Without it a move issued in the middle of
     * a drag would report no button held and the engine would read the contact as
     * lifted.
     */
    const heldButtons = new Set<PointerDeviceName>();

    const dispatchPointer = (
      type: PointerEventType,
      x: number,
      y: number,
      button: number,
      device: PointerDeviceName,
    ): void => {
      const at = toClient(engine.viewport(), base.shape.dpr, x, y);
      base.events.dispatchEvent(
        new PointerEventShim(type, {
          clientX: at.x,
          clientY: at.y,
          pointerId: POINTER_ID[device],
          pointerType: device,
          isPrimary: true,
          button,
          buttons: heldButtons.has(device) ? PRIMARY_BUTTON_BIT : 0,
        }),
      );
    };

    return {
      get world() {
        return engine.world;
      },
      get state() {
        return engine.world.state;
      },
      instance: initialized as GameInstance<FathomSurface>,

      async skip(ticks: number) {
        const clock = stepClocks.get(engine);
        if (clock === undefined || ticks < COAST_TICKS) {
          await base.advance(ticks);
          return;
        }
        const frames = Math.floor(ticks / COAST_TICKS);
        const rest = ticks - frames * COAST_TICKS;
        clock.ms = TICK_MS * COAST_TICKS;
        try {
          await base.advance(frames);
        } finally {
          clock.ms = TICK_MS;
        }
        if (rest > 0) await base.advance(rest);
      },

      async runFor(ms: number) {
        const controller = new AbortController();
        const running = engine.run({ signal: controller.signal });
        await new Promise((resolve) => setTimeout(resolve, ms));
        controller.abort();
        await running;
      },

      async movePointer(
        x: number,
        y: number,
        device: PointerDeviceName = "mouse",
      ) {
        dispatchPointer("pointermove", x, y, NO_BUTTON, device);
        await base.advance(1);
      },
      async pressPointer(
        x: number,
        y: number,
        device: PointerDeviceName = "mouse",
      ) {
        heldButtons.add(device);
        dispatchPointer("pointerdown", x, y, PRIMARY_BUTTON, device);
        await base.advance(1);
      },
      async releasePointer(
        x: number,
        y: number,
        device: PointerDeviceName = "mouse",
      ) {
        heldButtons.delete(device);
        dispatchPointer("pointerup", x, y, PRIMARY_BUTTON, device);
        await base.advance(1);
      },
    };
  },
});

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the logical design size, the build's exported
 * `BACKGROUND`, and the touch layout — so one harness serves every build of this
 * case. Everything else the build decided lives inside `src/game.ts`.
 */
export const createHarness = kit.createHarness;

/** Seconds of simulated time in `ticks` ticks of the default clock. */
export const seconds = kit.seconds;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Four properties are what make them usable, and each is deliberate:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that poses a corridor and then swims the forager down it records the
//    swim; the pose costs nothing, and the reviewer is not asked to scrub past a
//    minute of arrangement to reach the two seconds that decide the point.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing, and an over-long section is THINNED to the
//    package's cap rather than cut short: the reviewer sees the whole of a dive
//    at a lower frame rate instead of its first few seconds at the full one.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario. The suite behaves identically
//    either way, so a check cannot pass in one place and fail in the other.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swim = await captureReplay(h, "move", () => holdFor(h, "ArrowRight", 60));
 * assertTrue(swim.after.forager.x > swim.before.forager.x);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export const captureReplay = makeReplayCapture("fathom", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: what the unrevealed fog looks like,
 * which screen the game opened on, where the den sits. A recording of a still
 * screen would be the same frame three hundred times over, and a reviewer looking
 * at the fog wants to look at the fog.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// These pose a situation through the debug surface and then let the real
// simulation run. The GEOMETRY a scenario stands on comes from `fixtures.ts`, and
// its integrity from `scene.ts`; what is here is what needs the engine itself.
// Every threshold a check asserts is stated in the check, derived from the figure
// or rule the specs give for it.

/**
 * Open a dive and reach live play, through the surface alone.
 *
 * `reset` returns the game to the title on a freshly laid out maze, and
 * `setScreen("playing")` opens live play — which is where "the
 * staggered release schedule specs/predators.md fixes takes its origin"
 * (specs/instrumentation.md). No menu key is pressed on the way and no countdown
 * is waited out: a build with a broken title menu and working play must fail the
 * menu points and pass the play ones.
 *
 * The two calls are the whole of it, because each poses ONE thing: a scenario
 * that wants a score, a life count or a depth of its own poses that itself.
 *
 * Nothing is advanced here, so the caller's first tick is the game's first tick of
 * live play — which is what lets a scenario pose its board before anything moves.
 */
export function startPlaying(h: Harness): FathomSnapshot {
  h.debug.reset();
  h.debug.setScreen("playing");
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real pointer and a real finger                          */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (specs/ui.md), and WHERE a build lays the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`
// (specs/instrumentation.md), and drives a real pointer event at that region.
// Nothing here poses a pointer through the surface: a pose would tell the build
// where the pointer is without making the engine's own input layer deliver a
// press, a travel and a release the way a hand does, and what those checks are
// about is precisely that the game reads them.
//
// Each part of a gesture runs exactly ONE frame, so a caller counting frames can
// add them up.

/** Return the game to its title screen: `reset`, and nothing else. */
export function openTitle(h: Harness): void {
  h.debug.reset();
}

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on the four
 * screens that show no menu, or past the end of a menu — calls
 * `h.debug.menuItemRect` directly.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) to report the hit region of item ${index} on the ` +
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
  await h.movePointer(at.x, at.y);
}

/** Press and release the pointer inside item `index`'s region: two frames. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pressPointer(at.x, at.y);
  await h.releasePointer(at.x, at.y);
}

/**
 * Press on one item, travel to another, and release there: three frames.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * specs/ui.md states and a check reads back as a screen that did not change.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pressPointer(start.x, start.y);
  await h.movePointer(end.x, end.y);
  await h.releasePointer(end.x, end.y);
}

/**
 * Land a touch contact inside item `index`'s region and LEAVE IT DOWN.
 *
 * A confirm takes both of its edges inside one region and the lift is the second
 * of them (specs/ui.md), so a gesture that stops at the landing is the one
 * gesture that isolates what the landing alone did.
 */
export async function touchOntoItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pressPointer(at.x, at.y, "touch");
}

/**
 * Land a touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (specs/ui.md) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pressPointer(at.x, at.y, "touch");
  await h.releasePointer(at.x, at.y, "touch");
}

/**
 * Press and release the pointer at one point of the stage: two frames.
 *
 * For a screen that carries no item regions. specs/ui.md gives a gesture
 * completed on `"howto"` its effect anywhere on the screen rather than over a
 * region the build laid out, so there is nothing to ask `menuItemRect` for.
 */
export async function clickScreenAt(
  h: Harness,
  at: { x: number; y: number },
): Promise<void> {
  await h.pressPointer(at.x, at.y);
  await h.releasePointer(at.x, at.y);
}

/**
 * Land and lift a touch contact at one point of the stage: two frames.
 *
 * The counterpart of {@link clickScreenAt} for a finger, and for the same reason.
 */
export async function tapScreenAt(
  h: Harness,
  at: { x: number; y: number },
): Promise<void> {
  await h.pressPointer(at.x, at.y, "touch");
  await h.releasePointer(at.x, at.y, "touch");
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pressPointer(start.x, start.y, "touch");
  await h.movePointer(end.x, end.y, "touch");
  await h.releasePointer(end.x, end.y, "touch");
}

/** The forager, the way most checks name it. */
export function forager(snapshot: FathomSnapshot): FathomSnapshot["forager"] {
  return snapshot.forager;
}

/**
 * The predator at `index` of the roster, asserted present.
 *
 * specs/state.md lists the roster in release order and fixes one stable index per
 * predator, which is the index every predator operation selects by. A check that
 * poses predator `n` and then reads it back comes through here, so a roster too
 * short to hold it fails on the roster rather than on a `TypeError` several ticks
 * later.
 */
export function predator(
  snapshot: FathomSnapshot,
  index: number,
): PredatorSnapshot {
  const one = snapshot.predators[index];
  assertTruthy(
    one,
    `snapshot() must list the roster in release order, so index ${index} is a ` +
      `predator at this depth; see specs/state.md and specs/predators.md`,
  );
  return one as PredatorSnapshot;
}

/** The result of holding one key for a span of ticks. */
export interface HeldResult {
  before: FathomSnapshot;
  after: FathomSnapshot;
  /** The key that was held. */
  code: string;
  /** How many ticks it was held for. */
  ticks: number;
}

/**
 * Hold `code` for `ticks` ticks of the real simulation, then release it, and
 * report the state either side.
 *
 * Nothing here calls a pose, so the game stays under normal player control and the
 * forager responds to the held action exactly as it does for a player. The key is
 * released before the snapshot is taken, so a scenario that continues afterwards
 * starts from rest.
 */
export async function holdFor(
  h: Harness,
  code: string,
  ticks: number,
): Promise<HeldResult> {
  const before = h.snapshot();
  h.hold(code);
  await h.advance(ticks);
  const after = h.snapshot();
  h.release(code);
  return { before, after, code, ticks };
}

/**
 * Hold `code` until `predicate` holds or the budget runs out, then release it.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build that is
 * merely too slow FAILS on the bound the check states rather than running until
 * the suite times out.
 */
export async function holdUntil(
  h: Harness,
  code: string,
  predicate: (snapshot: FathomSnapshot) => boolean,
  options: UntilOptions = {},
): Promise<UntilResult> {
  h.hold(code);
  try {
    return await h.until(predicate, options);
  } finally {
    h.release(code);
  }
}

/* ---- Reading the board ---------------------------------------------------- */

/** The logical center of tile `(tx, ty)`, from the snapshot's own grid frame. */
export function centerOf(
  snapshot: FathomSnapshot,
  tile: Tile,
): { x: number; y: number } {
  return tileCenter(snapshot.grid, tile);
}

/** The visibility character reported for tile `(tx, ty)`. */
export function visibilityAt(
  snapshot: FathomSnapshot,
  tile: Tile,
): string | undefined {
  return snapshot.visibility[tile.ty]?.[tile.tx];
}

/* ---- Reading the pixels --------------------------------------------------- */
//
// These read the pixels the build actually PAINTS, so a build cannot pass by
// reporting a color it does not draw. A sample needs a frame to have been drawn
// since the scene was posed, so every one of them follows an `advance`.
//
// TWO OF THEM ARE THE SHARED HARNESS'S UNDER FATHOM'S NAME, and which one is
// bound matters. The package ships two ways of reducing a color to one number —
// `luminance`, Rec. 709 weighted, and `meanChannel`, unweighted — and two ways of
// averaging — `meanColor` over a rectangle, and `meanOf` over a run of sampled
// points. Every threshold in this suite was measured against the UNWEIGHTED mean
// of a cluster of points, so those are what is bound here, under the names the
// checks already say. Binding the weighted one instead would compile perfectly
// and rescale every brightness bound in the trench.

/** The color at a logical point, as the frame on the canvas holds it. */
export function colorAt(h: Harness, x: number, y: number): Rgb {
  return rgbOf(h.pixel(x, y));
}

/** The color at the center of a tile. */
export function colorAtTile(
  h: Harness,
  snapshot: FathomSnapshot,
  tile: Tile,
): Rgb {
  const at = centerOf(snapshot, tile);
  return colorAt(h, at.x, at.y);
}

/**
 * How far out from a point the cluster {@link sampleColor} averages over reaches,
 * in logical units.
 *
 * Three units stays well inside one `TILE` (32), so the whole cluster is on the
 * tile it is sampling and a single anti-aliased pixel cannot decide a verdict.
 */
const CLUSTER_RADIUS = 3;

/** The mean color over a five-point cluster about a logical point. */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return clusterColor(h, x, y, CLUSTER_RADIUS);
}

/**
 * The mean color at the center of a tile, over the cluster {@link sampleColor}
 * reads.
 *
 * The cluster is what keeps a single anti-aliased pixel from deciding a verdict,
 * and it stays well inside the tile.
 */
export function sampleColorAtTile(
  h: Harness,
  snapshot: FathomSnapshot,
  tile: Tile,
): Rgb {
  const at = centerOf(snapshot, tile);
  return sampleColor(h, at.x, at.y);
}

/**
 * How far apart two colors are, as the euclidean distance in RGB.
 *
 * The review items that bound this state their tolerance out of `441`, which is
 * the largest distance this can return.
 */
export { colorDistance };

/**
 * A color's mean channel, as the brightness the fog points bound.
 *
 * The package's `meanChannel`, which is the UNWEIGHTED mean this suite's every
 * threshold was measured against — never its `luminance`, which is Rec. 709
 * weighted and would rescale each of them silently.
 */
export { meanChannel as luminance };

/**
 * The mean color over a ring of `radius` units about a logical point.
 *
 * An amber mote's core blows out toward white by design, so the amber hue reads in
 * the halo around it rather than at the center. At radius `0` it is the center
 * pixel itself.
 */
export function sampleRing(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): Rgb {
  return ringColor(h, x, y, radius);
}

/**
 * A warm amber light: the bonus drifter's mote and the Lanternjaw's bulb.
 *
 * specs/gameplay.md fixes the mote's color and that it is drawn at all times and
 * at any distance, and specs/assets.md gives the amber palette color; neither
 * fixes the glow's size or its falloff. So this is a HUE test rather than a
 * color match: red-leaning, green above blue, clearly warm, and lit rather than
 * fog.
 */
export function isAmber(color: Rgb): boolean {
  return (
    color.r > 110 &&
    color.r >= color.g &&
    color.g > color.b &&
    color.r - color.b > 40 &&
    meanChannel(color) > 40
  );
}

/**
 * The radii, in units out from a mote's center, that {@link sampleMoteProfile}
 * reads it at.
 *
 * WHY A PROFILE AND NOT ONE RING. The specs fix the mote's color and, in words,
 * its shape, and nothing else: not the orb's radius, not how bright its core is,
 * not how fast the glow falls off. A build that draws the same light tighter
 * paints an unmistakable amber mote that a single five-unit ring reads as dark
 * fog, and a build that draws it wider blows that ring out to white. Both are the
 * mote the specs ask for, so "is it amber" is asked of the profile rather than of
 * one arbitrary ring. That still fails a build that draws no amber light at all,
 * because nothing in the fog reads amber at ANY radius.
 */
export const MOTE_RADII: readonly number[] = [0, 2, 4, 6, 8, 10];

/**
 * How far from the reported position a mote's drawn light may sit, in units, and
 * how finely that neighborhood is searched for it.
 *
 * WHY THE PROFILE IS RE-CENTRED BEFORE IT IS READ. A mote is drawn on a body, and
 * where on that body the light sits is the build's own art: one draws the glow on
 * the entity's center, another puts it at the top of the sprite as a bulb on a
 * bell would be. Reading the rings about the reported pixel therefore measures art
 * rather than conformance. A run drew its bulb six units up — plainly, visibly
 * amber, and amber at every radius about its own center — and was failed for a
 * ring centered six units below it that averaged out dim.
 *
 * The search stays well inside one tile: it is looking for the light on this
 * creature, not for some other light nearby.
 */
export const MOTE_SEARCH = 12;
const MOTE_SEARCH_STEP = 6;

/**
 * How finely {@link near} walks the neighborhood, in units.
 *
 * Finer than {@link findMoteCenter}'s own step, because these read the brightest
 * SAMPLE rather than choose a lattice point to read a profile about: a mote a few
 * units across has to be landed on, not merely bracketed.
 */
const NEAR_STEP = 3;

/**
 * Every point of a `2 * MOTE_SEARCH` square about `(x, y)`, on a grid of `step`,
 * read one at a time.
 *
 * One point rather than a cluster average, because a mote is small: an average
 * over the whole neighborhood would wash an unmistakable light out to the fog
 * around it.
 */
function sampledOn(
  h: Harness,
  x: number,
  y: number,
  step: number,
): NearSample[] {
  return gridPoints(x, y, MOTE_SEARCH, step).map((point) => ({
    color: colorAt(h, point.x, point.y),
    x: point.x,
    y: point.y,
  }));
}

/**
 * The brightest not-cool point within {@link MOTE_SEARCH} of `(x, y)`: the mote's
 * drawn center, wherever the build chose to put it on the body.
 *
 * Not COOLER than neutral, and as bright as possible. An amber mote's core blows
 * out to near-white by design, so requiring the core itself to read warm would
 * skip the very pixel being searched for and settle for the dim halo — or, out in
 * the fog where there is no halo, for nothing at all. The cool trench and the
 * forager's own glow are still rejected, both being blue-leaning. Where the
 * neighborhood holds nothing warm at all it answers `(x, y)`, so a build that
 * draws no mote is read exactly where it should have drawn one.
 */
export function findMoteCenter(
  h: Harness,
  x: number,
  y: number,
): { x: number; y: number } {
  const found = brightestIn(
    sampledOn(h, x, y, MOTE_SEARCH_STEP),
    meanChannel,
    (color) => color.r >= color.b,
  );
  return found === null ? { x, y } : { x: found.x, y: found.y };
}

/** One sample of the neighborhood a creature's mote would be drawn in. */
function near(h: Harness, x: number, y: number): NearSample[] {
  return sampledOn(h, x, y, NEAR_STEP);
}

/** The brightest pixel within {@link MOTE_SEARCH} of `(x, y)`, whatever its hue. */
export function brightestNear(h: Harness, x: number, y: number): NearSample {
  // The grid always carries its own center, so there is always a brightest.
  return brightestIn(near(h, x, y), meanChannel) as NearSample;
}

/**
 * The brightest RED-LEANING pixel within {@link MOTE_SEARCH} of `(x, y)`, or
 * `null` where the neighborhood holds none.
 *
 * "Red-leaning" is the whole of the hue test, and it is the wording the review
 * items that read a mote this way use: "has its red channel above its blue". No
 * figure anywhere fixes how bright an amber mote is or how fast its glow falls
 * off, so a brightness threshold baked in here would fail a build that draws a
 * dimmer light and satisfies every stated requirement. HOW FAR above the fog a
 * mote must read is stated by the check, against a fog sample it took itself.
 *
 * `brightestIn` takes the score as an argument precisely because the package's
 * two luminances pick different pixels out of one neighborhood; this passes the
 * unweighted one, which is what {@link luminance} is bound to above.
 */
export function brightestWarmNear(
  h: Harness,
  x: number,
  y: number,
): NearSample | null {
  return brightestIn(near(h, x, y), meanChannel, (color) => color.r > color.b);
}

/** One sample of a mote's profile. */
export interface MoteSample {
  radius: number;
  color: Rgb;
}

/**
 * A mote's rendered color profile at each of {@link MOTE_RADII}, innermost first,
 * read about the mote's own drawn center.
 */
export function sampleMoteProfile(
  h: Harness,
  x: number,
  y: number,
): MoteSample[] {
  const center = findMoteCenter(h, x, y);
  return MOTE_RADII.map((radius) => ({
    radius,
    color: sampleRing(h, center.x, center.y, radius),
  }));
}

/** The innermost sample of `profile` that reads as a warm amber light, or `null`. */
export function amberInProfile(
  profile: readonly MoteSample[],
): MoteSample | null {
  return profile.find((sample) => isAmber(sample.color)) ?? null;
}

/**
 * How far apart two motes are drawn, as the LARGEST color distance between their
 * samples at the same radius.
 *
 * Comparing like radius with like keeps the reading honest: two motes drawn
 * identically match at every radius, and one drawn differently — a wider halo, a
 * colder core — separates somewhere in the profile even where it happens to agree
 * on one ring.
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
