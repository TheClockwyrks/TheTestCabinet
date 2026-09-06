// Fathom — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT FATHOM'S. Building the canvas and the
// recorder over it, standing the runtime up on it, reading the debug surface back
// off it and standing something in when the build returned none, threading a PURE
// surface through `engine.apply`, the frame sweep, the key and pointer events, the
// cue stamping, the pixel readings, and the evidence a review point declares —
// every engine-backed case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`. What is
// left here is what is genuinely Fathom's: the shape of its surface, the tick it
// counts in, the scenarios it poses, and the readings a trench of dark water and
// small amber lights is made of.
//
// The seam is one call. `createEngineCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object — including the ENGINE itself,
// which the package names nowhere and cannot — and hands back the machinery with
// Fathom's names and Fathom's types on it, so the 158 suites next door go on
// importing `createHarness`, `captureReplay` and `startPlaying` from `../harness`
// exactly as they did.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the runtime's frame counter, the events the runtime broadcast, and
// — for the rendering checks — the pixels on the canvas or the calls the 2D
// context received. Nothing here fabricates an outcome: the scenario helpers
// below and in `fixtures.ts` only ARRANGE the world through the debug surface,
// and the real `update` the build wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `setMaze`
// takes a fixture exactly as given and sets the layout alone, `clearPredators`
// empties the roster outright, `setBrightHold` arms the hold beside a posed `G`,
// and the two faculty switches gate one hunter's mind and its travel apart —
// `setPredatorMind(index, false)` leaves a prop that decides nothing,
// `setPredatorTravel(index, false)` a hunter that senses and alerts without ever
// leaving its tile — each of them leaving the rest of the simulation running.
// Posing through it is how a scenario is reproducible, and it is the seam the
// case's specification documents. `surface.ts` is that specification as types, and
// it is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the runtime
// holds the second element and returns it from `engine.debug`. The package's
// `readDebugSurface` does that read and stands an `absentSurface` in when there is
// nothing to read, so a build that returned no surface fails the points whose
// checks reach the game through it rather than the `beforeEach` that built the
// harness. {@link SURFACE_REQUIREMENT} is the sentence such a failure names, and
// it is the case's because where the surface comes from is this engine's business.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a simple
// engine's state model forces. The runtime holds the state BY VALUE and hands it
// out read-only, so the surface is pure: a pose is `(state, ...args) => State` and
// a reading is `(state, ...args) => R`, and neither can be called by a check
// directly because neither has the state. The package's `applyDriver` supplies it
// — a reading is handed `engine.state` and everything else the check passed, a
// pose is run through `engine.apply` so the state it returns is the state the next
// frame receives — and `surface.ts`'s `READINGS` is what tells the two apart,
// because nothing about a pure surface distinguishes them at run time:
// `menuItemRect` takes an index beside the state exactly as `setMenuIndex` does.
// Nothing a check does holds a writable state — `h.state` is the runtime's current
// value, read fresh on every access, and the only way to change it is a pose.
//
// THE CLOCK. A constant `TICK_MS` step is the default, at the simulation's own
// tick length, so ONE ADVANCED FRAME IS ONE TICK: the frame's delta completes
// exactly one `TICK_DT` and carries no remainder (specs/movement.md). Every
// duration in this suite is therefore a whole number of frames, which is the unit
// a frame-counted tolerance is stated in. {@link Harness.skip} is the one
// exception, and it is the reason the default clock is this file's own
// {@link StepClock} rather than the engine's `ConstantClock`: a march run off
// camera hands the engine several ticks' worth of delta at a time and draws once,
// which specs/movement.md makes the same simulation. A check that is specifically
// about the step size builds harnesses with clocks of its own.
//
// WHERE THE SCENARIOS LIVE. The geometry a check poses is in `fixtures.ts`, the
// helpers that empty a world and read what a posed one did are in `scene.ts`,
// and the structural measures the `maze/*` checks read are in `maze.ts`. All
// three are byte-identical in every engine directory and import nothing of the
// build. What is here is what only this engine can supply: the runtime, the
// keyboard, the pointer, the pixels, and the evidence.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
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
  applyDriver,
  createEngineCaseHarness,
  rasterize,
  type AssetFailure,
  type EngineHarness,
  type EngineHarnessOptions,
  type EngineViewport,
  type PointerEventType,
  type PureDriver,
  type TimedCue,
  type UntilOptions as BaseUntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/engine/index";
import {
  makeReplayCapture,
  sampleColor as clusterColor,
  sampleRing as ringColor,
} from "./case-harness/engine/2d";
import { drawnText as rawDrawnText } from "./case-harness/text";
import { BACKGROUND, game as build, type FathomState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import { BINDINGS, LAYOUT, STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import { tileCenter, type Dir, type Tile } from "./maze";
import { MOTION_EPS } from "./scene";
import {
  READINGS,
  type FathomDebugApi,
  type FathomSnapshot,
  type MenuRect,
} from "./surface";

export type { Dir, Tile };

/* The readings this project takes straight off the package, under its names. */
export type { AssetFailure, DrawCall, NearSample, Rgb, TimedCue };
export { callsTo, setsOf };

/** One cue the build played, as the runtime announced it. */
export type PlayedCue = TimedCue;

/** The case's surface, bound to the state type the build declared. */
export type FathomSurface = FathomDebugApi<FathomState>;

/**
 * The surface as every check drives it: every member of the pure surface, minus
 * its state argument, over the runtime that holds the state.
 *
 * Optional members stay optional, so a variant-only pose would still be
 * `h.debug.op?.(...)`.
 */
export type FathomDriver = PureDriver<
  DeepReadonly<FathomState>,
  FathomState,
  FathomSurface
>;

/** The runtime this project stands a build up on. */
export type FathomEngine = Engine<FathomState, FathomSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<FathomState, FathomSurface>` here and the runtime is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<FathomState, FathomSurface>;

/**
 * The frame this suite steps in, in milliseconds.
 *
 * `TICK_HZ` is the simulation's own rate (specs/movement.md), so a frame of this
 * length completes exactly one tick and carries no remainder. That is what makes
 * `advance(n)` mean "n ticks" everywhere in this project.
 */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * The key each movement action's ARROW binding sits on, read off `BINDINGS`.
 *
 * The letter bindings are the same actions on other keys (specs/movement.md), and
 * the `wasd/*` checks name them directly; a scenario that merely needs the
 * forager to travel takes the arrow.
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
 * comes from is this engine's business — beside the state, as a pair — and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

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
 * The {@link StepClock} each runtime was built on, or nothing where the check
 * supplied a clock of its own.
 *
 * `skip` retunes the clock the harness is actually running, so it has to reach
 * the object the factory was handed rather than a fresh one — and the factory is
 * the one place both the clock and the runtime it went into are in hand. A weak
 * map, so a disposed harness's entry goes with it, and keyed by the runtime
 * because that is what `extend` is given.
 */
const stepClocks = new WeakMap<object, StepClock>();

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
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
 * Unrounded, which is the package's `"exact"` precision under its own name here:
 * a menu item's edge is where a fraction of a unit decides the reading.
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

/** The window a harness reports to the runtime, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** How far a sweep may run, and how many frames separate two samples. */
export type UntilOptions = BaseUntilOptions;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<FathomSnapshot>;

/** Everything this harness carries past the package's neutral contract. */
export interface FathomModel {
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose
   * it through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FathomState>;
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
  /** Drive the runtime's own frame loop for `ms` of real time, then halt it. */
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

/** Everything a check reads off one runtime running one build. */
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
 *  - `driver` is the apply-threaded strategy, over `surface.ts`'s `READINGS`. It
 *    forwards a reading's own arguments past the state, which is what keeps
 *    `menuItemRect(index)` an indexed read rather than a read about item zero.
 *  - `toLogical` is left at the identity. There is no camera under this engine —
 *    the runtime maps the stage onto the canvas and nothing else stands between.
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
    const engine = createEngine<FathomState, FathomSurface>({
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
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<FathomState>, FathomState, FathomDriver>(
      engine,
      raw,
      { readings: READINGS },
    ),
  snapshot: (debug) => debug.snapshot(),
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
  extend: (base, engine) => {
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
      get state() {
        return engine.state;
      },

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
 * Build a runtime over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the touch layout — so one harness serves every build of this case. Everything
 * else the build decided lives inside `src/game.ts`.
 */
export const createHarness = kit.createHarness;

/** Frames of the default clock in `seconds` of simulated time, rounded up. */
export const ticks = kit.ticks;

/** Seconds of simulated time in `frames` frames of the default clock. */
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
//    check that poses a corridor and then swims it records the swim; the pose
//    costs nothing, and the reviewer is not asked to scrub past the arrangement
//    to reach the two seconds that decide the point. It is also how a march to a
//    state — losing three lives, waiting out a den schedule — is kept OUT of a
//    clip: drive it with {@link Harness.skip} before the capture opens.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing, and an over-long section is THINNED to the
//    package's cap rather than cut short.
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
 * const swum = await captureReplay(h, "move", () => driveHeldKey(h, "right"));
 * assertEqual(swum.after.dir, "right");
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
 * PICTURE rather than a stretch of motion: the maze the build laid out, how dark
 * the unrevealed fog is, which screen the game opened on. A recording of a still
 * screen would be the same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Reaching live play                                                         */
/* -------------------------------------------------------------------------- */
//
// Everything below poses a situation through the debug surface and then lets the
// real simulation run. It fixes only geometry and the state a scenario opens on.
// Every threshold a check asserts is stated in the check itself, derived from the
// figure or the rule specs/ states for it.

/**
 * Open a dive and reach live play through the surface alone, and hand back the
 * state it reaches.
 *
 * Two operations: `reset(seed)` for a reproducible board — a freshly laid out
 * maze at depth 1 with the roster in the den — and `setScreen("playing")` for
 * live play. Nothing here touches a menu: a build with a broken title screen and
 * a working dive must fail the navigation checks and pass the gameplay ones, so a
 * check that is about the menus drives them itself.
 *
 * The den's release schedule takes its origin from the moment `screen` becomes
 * `"playing"` (specs/instrumentation.md), which is what the `den/*` checks time
 * against.
 *
 * It leaves the board the game laid out: a plankton on every corridor tile and
 * the whole roster in the den. A check that measures on a posed fixture reaches
 * for `poseMaze`, which empties all of that.
 */
export async function startPlaying(
  h: Harness,
  options: { seed?: number } = {},
): Promise<FathomSnapshot> {
  h.debug.reset(options.seed);
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
export function openTitle(h: Harness, seed?: number): void {
  h.debug.reset(seed);
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
 * A confirm requires both of its edges inside one region and the lift is the second
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

/**
 * Pose a steady brightness: `G` at `g`, held there for `hold` seconds.
 *
 * `specs/instrumentation.md` splits the two, so `setBrightness` alone poses a `G`
 * that begins decaying on the next tick. A check that wants a brightness to still
 * be what it posed a moment later arms the hold beside it, which is the pair
 * eating a plankton arms. `hold` is the check's own figure, stated where the
 * check states its thresholds.
 */
export function poseBrightness(h: Harness, g: number, hold: number): void {
  h.debug.setBrightness(g);
  h.debug.setBrightHold(hold);
}

/**
 * The FORAGER travelled between the two readings, or the check FAILS.
 *
 * The mirror of `scene.ts`'s `requirePredatorMotion`, for the points that reach
 * their subject by swimming the forager into something: a plankton to be paid
 * for, a corner to round, the rock that closes a corridor. A forager that covered
 * no ground at all did not exhibit the behavior the point is about, so there is
 * no reading to take from it and nothing left to grade but a failure.
 *
 * `what` names the travel the scenario asked for, so the failure says which
 * movement never happened rather than which figure came out wrong.
 */
export function requireForagerMotion(
  before: FathomSnapshot,
  after: FathomSnapshot,
  what: string,
): void {
  const moved = Math.hypot(
    after.forager.x - before.forager.x,
    after.forager.y - before.forager.y,
  );
  if (moved >= MOTION_EPS) return;
  fail(
    `the forager to travel under a held movement action so it could ${what}; ` +
      "specs/movement.md has it travel while one is held",
    `${moved.toFixed(1)} units moved`,
  );
}

/**
 * Open a dive and stop on its countdown, without ending it.
 *
 * How a countdown scenario reaches its ground: `reset` to a clean title, then
 * `setScreen("countdown")`, nothing else.
 */
export async function openCountdown(
  h: Harness,
  options: { seed?: number } = {},
): Promise<FathomSnapshot> {
  h.debug.reset(options.seed);
  h.debug.setScreen("countdown");
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Driving the forager by key                                                 */
/* -------------------------------------------------------------------------- */

/** What a held movement key did: the forager either side of the hold. */
export interface HeldKeyResult {
  before: FathomSnapshot;
  /** The state after `ticks` frames of held input: what the check reads. */
  after: FathomSnapshot;
  /** The state at the end of the recorded tail, for a still. */
  settled: FathomSnapshot;
  code: string;
}

/**
 * Hold `code` and run the real simulation, so the held key drives the forager
 * through the game's own movement code.
 *
 * THE VERDICT IS READ AFTER EXACTLY `holdTicks` FRAMES, so the measured
 * displacement is the same however long the tail runs. The extra `tailTicks` are
 * held afterwards purely so a recorded clip shows the forager swimming for a
 * readable moment before the key is released; they cannot reach an assertion,
 * because the states the check reads were already taken.
 *
 * Nothing here poses the forager. Whatever the scenario left it standing on is
 * where it starts, and the only thing this does is press a key.
 */
export async function driveHeldKey(
  h: Harness,
  code: string,
  options: { holdTicks?: number; tailTicks?: number } = {},
): Promise<HeldKeyResult> {
  const { holdTicks = 30, tailTicks = 60 } = options;
  const before = h.snapshot();
  h.hold(code);
  try {
    await h.advance(holdTicks);
    const after = h.snapshot();
    await h.advance(tailTicks);
    return { before, after, settled: h.snapshot(), code };
  } finally {
    h.release(code);
  }
}

/**
 * How far the forager travelled along `dir`, in logical units, wrap-free.
 *
 * POSITION, NOT THE TILE INDEX. A hold of a whole tile's worth of travel lands
 * precisely on a tile boundary, and which side of it the index has reached comes
 * down to floating-point accumulation and to WHEN a build flips the index — on
 * crossing the boundary geometrically, or on arriving at the next center.
 * specs/state.md pins neither ("the tile whose bounds contain its center"), so no
 * tile-index comparison is an honest signal. Position is exact, convention-free,
 * and sits in the same snapshot.
 */
export function travelAlong(
  before: FathomSnapshot,
  after: FathomSnapshot,
  dir: Dir,
): number {
  const dx = after.forager.x - before.forager.x;
  const dy = after.forager.y - before.forager.y;
  if (dir === "left") return -dx;
  if (dir === "right") return dx;
  if (dir === "up") return -dy;
  return dy;
}

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// TWO OF THE READINGS BELOW ARE THE SHARED HARNESS'S UNDER FATHOM'S NAME, and
// which one is bound matters. The package ships two ways of reducing a color to
// one number — `luminance`, Rec. 709 weighted, and `meanChannel`, unweighted —
// and two ways of averaging — `meanColor` over a rectangle, and `meanOf` over a
// run of sampled points. Every threshold in this suite was measured against the
// UNWEIGHTED mean of a cluster of points, so those are what is bound here, under
// the names the checks already say. Binding the weighted one instead would
// compile perfectly and rescale every brightness bound in the trench.

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return rawDrawnText(calls);
}

/** The center of tile `(tx, ty)` in logical units, from a snapshot's own grid. */
export function centerOf(
  snapshot: FathomSnapshot,
  tile: Tile,
): {
  x: number;
  y: number;
} {
  return tileCenter(snapshot.grid, tile);
}

/**
 * How far out from a point the cluster a color is averaged over reaches, in
 * logical units.
 *
 * Four units stays well inside one `TILE` (32), so the whole cluster is on the
 * tile it is sampling. A cluster rather than one pixel is what keeps a stray
 * anti-aliased pixel or a hair of dithering from swinging a reading.
 */
const CLUSTER_RADIUS = 4;

/**
 * The rendered color at a logical point, averaged over a small cluster: the
 * center pixel plus four neighbors {@link CLUSTER_RADIUS} out on the axes.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return clusterColor(h, x, y, CLUSTER_RADIUS);
}

/** The rendered color at the center of a tile, averaged as {@link sampleColor}. */
export function sampleTile(
  h: Harness,
  snapshot: FathomSnapshot,
  tile: Tile,
): Rgb {
  const { x, y } = centerOf(snapshot, tile);
  return sampleColor(h, x, y);
}

/** Euclidean distance between two colors, 0 to about 441. */
export { colorDistance };

/**
 * A color's mean channel value, the reading the unrevealed fog is darkest on.
 *
 * The package's `meanChannel`, which is the UNWEIGHTED mean this suite's every
 * threshold was measured against — never its `luminance`, which is Rec. 709
 * weighted and would rescale each of them silently.
 */
export { meanChannel as luminance };

/**
 * The color is RED-LEANING: the reading specs/overview.md gives the two amber
 * lights, "red-leaning and clearly warmer than the water, the rock, and the
 * forager's own light", operationalized exactly as every review item that reads
 * a mote words it — "with its red channel above its blue".
 *
 * Deliberately a HUE test and nothing more, and deliberately only the ONE
 * comparison. The palette is the build's (specs/overview.md leaves it so), and no
 * figure anywhere fixes how bright an amber mote is, how fast its glow falls off,
 * or where between red and yellow the build's amber sits — so neither a threshold
 * on brightness nor a second channel comparison belongs here, and either would
 * fail a build that satisfies every stated requirement. HOW MUCH warmer than its
 * surroundings a mote must read is the CHECK's to state, against a fog sample it
 * took itself: that is the comparison specs/overview.md actually makes.
 *
 * The one predicate for the whole suite. Every reading of an amber light — the
 * bulb, the drifter, the pair the sonar must leave alone, the light the Kindle
 * circle clips away — asks this and nothing else, so two checks cannot disagree
 * about what amber is.
 */
export function isWarm(c: Rgb): boolean {
  return c.r > c.b;
}

/**
 * The radii, in logical units out from a mote's center, that
 * {@link sampleMoteProfile} reads it at.
 *
 * WHY A PROFILE AND NOT ONE RING. specs/sensing.md fixes the mote's color and
 * that it is a single glowing point, and nothing else: not its radius, not how
 * bright its core is, not how fast the glow falls off. A build that draws the
 * light tighter — an amber core a couple of units across under a fainter halo —
 * paints an unmistakable amber mote that one fixed ring reads as dark fog, and a
 * build that draws it wider blows that ring out to white. Both are the mote the
 * specification asks for, so the reading is taken across a spread of radii and
 * "is it warm" is asked of the profile rather than of one arbitrary ring.
 */
export const MOTE_RADII: readonly number[] = [0, 2, 4, 6, 8, 10];

/** How far from a reported position a mote's drawn light may sit, in units. */
export const MOTE_SEARCH = 12;

/** One sample of a mote's profile. */
export interface MoteSample {
  radius: number;
  color: Rgb;
}

/** The color at `radius` out from a point: the pixel itself, or a 6-point ring. */
export function sampleRing(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): Rgb {
  return ringColor(h, x, y, radius);
}

/** How coarsely {@link findMote} walks a mote's neighborhood, in logical units. */
const MOTE_FIND_STEP = 6;

/**
 * The brightest not-cool point within {@link MOTE_SEARCH} of `(x, y)`: a mote's
 * drawn center, wherever on the body the build chose to put it.
 *
 * A mote is drawn on a creature, and where on that creature the light sits is the
 * build's art: one draws the glow on the entity's center, another puts it at the
 * top of the sprite as a bulb on a bell would be. specs/sensing.md fixes the
 * light's color and that it is always drawn; it does not fix it to the unit the
 * snapshot reports the creature at. Cool pixels are rejected, so the trench and
 * the forager's own glow cannot be mistaken for one; an amber core that blows out
 * toward white is not, which is why the test is `r >= b` rather than
 * {@link isWarm}.
 *
 * Falls back to `(x, y)` when the neighborhood holds nothing warm at all, so a
 * build that draws no mote is read exactly where it should have drawn one.
 */
export function findMote(
  h: Harness,
  x: number,
  y: number,
): { x: number; y: number } {
  const found = brightestIn(
    sampledOn(h, x, y, MOTE_FIND_STEP),
    meanChannel,
    (color) => color.r >= color.b,
  );
  return found === null ? { x, y } : { x: found.x, y: found.y };
}

/** A mote's color profile, innermost first, read about its own drawn center. */
export function sampleMoteProfile(
  h: Harness,
  x: number,
  y: number,
): MoteSample[] {
  const center = findMote(h, x, y);
  return MOTE_RADII.map((radius) => ({
    radius,
    color: sampleRing(h, center.x, center.y, radius),
  }));
}

/**
 * How finely {@link nearSamples} walks a mote's neighborhood, in logical units.
 *
 * Three units across the {@link MOTE_SEARCH} reach is 81 samples, fine enough to
 * land inside the halo of a mote a build draws only a few units across, and
 * coarse enough that a check reading two creatures pays for it once.
 */
export const MOTE_STEP = 3;

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
    color: rgbOf(h.pixel(point.x, point.y)),
    x: point.x,
    y: point.y,
  }));
}

/** Every pixel within {@link MOTE_SEARCH} of `(x, y)`, on a {@link MOTE_STEP} grid. */
function nearSamples(h: Harness, x: number, y: number): NearSample[] {
  return sampledOn(h, x, y, MOTE_STEP);
}

/** The brightest pixel within {@link MOTE_SEARCH} of `(x, y)`, whatever its hue. */
export function brightestNear(h: Harness, x: number, y: number): NearSample {
  // The grid always carries its own center, so there is always a brightest.
  return brightestIn(nearSamples(h, x, y), meanChannel) as NearSample;
}

/**
 * The brightest RED-LEANING pixel within {@link MOTE_SEARCH} of `(x, y)`, or
 * `null` where the neighborhood holds none: a creature's amber light, wherever on
 * its body the build chose to draw it.
 *
 * The hue test is {@link isWarm} and nothing more, so how bright a mote is and
 * how fast its glow falls off stay the build's own. HOW FAR above the fog it must
 * read is stated by the check, against a fog sample the check took itself.
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
  return brightestIn(nearSamples(h, x, y), meanChannel, isWarm);
}

/**
 * How far apart two motes are drawn: the LARGEST color distance between their
 * samples at the same radius.
 *
 * Comparing like radius with like keeps the reading honest. Two motes drawn
 * identically match at every radius, and one drawn differently — a wider halo, a
 * colder core — separates somewhere in the profile even if it happens to agree on
 * one ring. specs/sensing.md requires the drifter and the bulb to be drawn alike,
 * so which glimmer is which is not readable at a glance.
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
 * The color the engine clears the canvas to each frame, rasterized through the
 * same canvas implementation the harness samples with.
 *
 * The fill is repeated rather than applied once so a translucent color reads as
 * the engine leaves it: the engine composites its clear over the previous frame
 * every frame, which converges on the color's own channels, and a single fill
 * over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  return rgbOf([...rasterize(BACKGROUND), 255]);
}

/** The visibility character a snapshot reports for one tile: `u`, `r` or `l`. */
export function visibilityOf(snapshot: FathomSnapshot, tile: Tile): string {
  const row = snapshot.visibility[tile.ty];
  const at = row === undefined ? undefined : row[tile.tx];
  assertTruthy(
    at,
    `snapshot().visibility must report ${snapshot.grid.rows} rows of ` +
      `${snapshot.grid.cols} characters (specs/state.md)`,
  );
  return at as string;
}
