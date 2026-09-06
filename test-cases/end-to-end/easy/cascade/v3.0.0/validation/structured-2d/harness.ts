// Cascade — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY OF THAT PARAGRAPH IS NOT CASCADE'S. The canvas and its
// draw-command recorder, the debug surface and the stand-in for a missing one,
// the frame sweep, the pointer and key events, the cue stamping, the pixel and
// text readings, and the evidence a review item's output is written from — every
// engine-backed case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`. What
// is left here is what is genuinely Cascade's: the shape of its snapshot, the
// table its checks are posed on, the tick rates its suites step at, the sentence
// a missing surface is failed against, and the readings its own geometry answers.
//
// The seam is one call. `createEngineCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object — including the ENGINE, which the
// package names none of — and hands back the machinery under Cascade's names and
// Cascade's types, so the suites next door go on importing `createHarness`,
// `captureStill` and `h.drawFrame()` from `../harness` exactly as they did.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state — the
// events the engine broadcast (the cues), and — for the table, presentation and
// screens checks — the pixels on the canvas and the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the table through the debug surface, and the real rules the build
// wrote are what decide every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `addCard`
// puts a card on a pile the rules then apply to unchanged, `addWasteSet`
// records a turn's set the way a turn records one, `move` runs the game's own
// move rules and reports what they decided, `pointerDown` feeds the same input
// path the player's pointer feeds, and `reset` gives everything back. Posing
// through it is how a scenario is reproducible, and it is the seam the case's
// specification documents. `surface.ts` is that specification as types, and it
// is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check. The
// package's `readDebugSurface` does that read and stands an `absentSurface` in
// when there is nothing to read, so a build that returned no surface fails the
// checks that reach the game through it and never the `beforeEach` that built
// the harness.
//
// HOW THE SURFACE IS DRIVEN — the IDENTITY strategy, which is what a structured
// engine's state model allows. A pose acts on the live game at the moment of the
// call and a reading is built at the call (specs/instrumentation.md), so the
// object the build returned IS the driver and nothing stands between a check and
// it. A scenario poses and then reads with no frame in between; the three pointer
// operations resolve their event before they return, so a whole gesture — press,
// sweep, release — is driveable without advancing the game at all. A frame is
// advanced when the check wants the game to RUN: a flyer to travel, a launch
// clock to tick, a frame to be drawn.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field and a table is built one card at a time, so
// "every foundation complete but one card" is a helper here rather than an
// operation there. A check that needs only part of a sequence calls the
// operations it needs, and nothing it did not ask for happens. The helpers fix
// GEOMETRY — which column a card is posed on, where a pile's anchor is, which
// point lies on a card — and never a threshold: every figure a check asserts is
// stated in that check, derived from what specs/ fixes for it.
//
// THE CLOCK IS THE HARNESS'S. Cascade mandates no timestep: every rate is per
// second and integrated against the delta the frame hands the game, which is why
// `[instrumentation]` carries no `tick_hz`. So the step is the SUITE's choice, a
// `ConstantClock` at {@link TICK_HZ}, and a duration is a whole number of frames
// on every machine. A group whose figures are under ACCELERATION — the cascade,
// where `vy` grows by `GRAVITY * dt` every frame — builds its harness at
// {@link CASCADE_HZ} instead, because a quantity under acceleration is NOT
// independent of how an interval was divided into frames.
//
// NO DOM, AND THE ONE THING THAT NEEDS ONE. These suites run under vitest's
// `node` environment: the engine takes every measurement from the
// `SurfaceMetrics` the harness supplies, so nothing here needs a document. The
// exception is the cascade's painted layer, which a build keeps on an offscreen
// drawing surface of its own (specs/victory.md) and which the package does not
// stand up; `./canvas-shim` stands both browser ways of making one up, and it is
// imported FIRST below so it is in place before a single module of the build has
// been evaluated.

import "./canvas-shim";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type World,
} from "@clockwyrks/structured-2d";
import {
  boundDrawLog,
  createEngineCaseHarness,
  identityDriver,
  rasterize,
  type EngineHarness,
  type EngineHarnessOptions,
  type TimedCue,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  pixelsChanged as pixelBytesChanged,
  sampleColor as sampleClusterColor,
} from "./case-harness/engine/2d";
import { colorDistance, rgbOf, type Rgb } from "./case-harness/color";
import {
  drawnText as rawDrawnText,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import type { DrawCall } from "./case-harness/draw-calls";
import {
  IDENTITY,
  apply,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import { rectCenter, type Point } from "./case-harness/point";
import {
  BACKGROUND,
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_COUNT,
  FOUNDATION_X,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TABLEAU_COLUMNS,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
  type Rect,
} from "./constants";
import { game as build } from "../src/game";
import { fail } from "./assert";
import { ALL_SUITS, type CardSpec } from "./fixtures";
import type {
  CascadeDebugApi,
  CascadeSnapshot,
  MenuRect,
  PileKind,
  Screen,
  SnapshotCard,
  SnapshotDrag,
  SnapshotDropTarget,
  SnapshotFlyer,
  SnapshotPointer,
  SnapshotPress,
  SourcePile,
  Suit,
  TargetPile,
} from "./surface";

export type {
  CascadeSnapshot,
  MenuRect,
  PileKind,
  Screen,
  SnapshotCard,
  SnapshotDrag,
  SnapshotDropTarget,
  SnapshotFlyer,
  SnapshotPointer,
  SnapshotPress,
  SourcePile,
  Suit,
  TargetPile,
};

// The vocabulary a scenario names cards in, re-exported so a validator writes
// one import: `card`, `down`, `alternatingRun`, the named ranks, and the rest.
export * from "./fixtures";

/** The case's surface, exactly as `surface.ts` specifies it. */
export type CascadeSurface = CascadeDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and acts on the live game, a reading takes nothing and returns
 * plain data — so no wrapper stands between a check and the object the build
 * returned, and the driver type is the surface type itself. The alias is kept
 * so a check reads the same way it does under an engine whose surface needs
 * driving.
 */
export type CascadeDriver = CascadeSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares and exports its own type for the surface its instance's
 * `initialize` returns — the `CascadeDebugApi` of its
 * `GameDefinition<CascadeDebugApi>` — and that type is the build's: what a
 * check holds it to is `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<CascadeSurface>` here and the engine is parameterized with
 * it. A surface that departs from the specification is caught where a check
 * reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<CascadeSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suites step in by default, in hertz.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took (specs/overview.md). Sixty is what a browser gives a game
 * on an ordinary display, so it is the honest default, and fixing it makes a
 * duration a whole number of frames — `0.1` s is six frames, `0.3` s is
 * eighteen — so a tolerance stated in frames means the same thing everywhere.
 */
export const TICK_HZ = 60;

/**
 * The frame the CASCADE group steps in.
 *
 * The cascade integrates under acceleration — `vy += GRAVITY * dt` every frame
 * — and a quantity under acceleration is NOT independent of how an interval was
 * divided into frames: one second taken as one frame and as sixty frames leave a
 * flyer in different places. A `cascade` check therefore builds its harness with
 * `createHarness({ hz: CASCADE_HZ })`, which is fine enough that a figure
 * quantised to a frame boundary still meets the tolerances those checks state,
 * and coarse enough that three seconds is seven hundred and twenty frames.
 */
export const CASCADE_HZ = 240;

/** Frames of a clock at `hz` covering `duration` seconds, rounded to whole. */
export function framesFor(duration: number, hz = TICK_HZ): number {
  return Math.round(duration * hz);
}

/** Seconds of game time in `frames` frames of a clock at `hz`. */
export function secondsFor(frames: number, hz = TICK_HZ): number {
  return frames / hz;
}

/* -------------------------------------------------------------------------- */
/* The table, in the space the surface speaks                                 */
/* -------------------------------------------------------------------------- */
//
// Arithmetic over the figures this project's own `constants.ts` transcribes
// from the specs. It says where the table's furniture IS, so a
// check can aim a press at a card or read where a build drew one; it decides
// nothing about the build, and a check that holds a build to one of these
// positions states that figure itself.

/** Every column index, `0` to `6`. */
export const COLUMNS: readonly number[] = Array.from(
  { length: TABLEAU_COLUMNS },
  (_, i) => i,
);

/** Every foundation index, `0` to `3`. */
export const FOUNDATIONS: readonly number[] = Array.from(
  { length: FOUNDATION_COUNT },
  (_, i) => i,
);

/** The anchor of one of the thirteen piles: the top-left its cards sit at. */
export function pileTopLeft(pile: PileKind, index = 0): Point {
  switch (pile) {
    case "stock":
      return { x: STOCK_X, y: TOP_ROW_Y };
    case "waste":
      return { x: WASTE_X, y: TOP_ROW_Y };
    case "foundation":
      return { x: FOUNDATION_X[index], y: TOP_ROW_Y };
    case "tableau":
      return { x: COLUMN_X[index], y: TABLEAU_Y };
  }
}

/** The centre of a card drawn with its top-left at `(x, y)`. */
export function cardCenter(x: number, y: number): Point {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** The centre of a rectangle — where a click on a control lands. */
export { rectCenter };

/** Whether a point lies inside a rectangle, its left and top edges included. */
export function inRect(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The face-up offset a column of these faces draws at (specs/table.md).
 *
 * `faces[i]` is whether the card at row `i` is face-up, bottom row first.
 * `FACE_UP_OFFSET` until the column's lowest card would pass
 * `COLUMN_BOTTOM_LIMIT`, then the largest uniform value that fits it above the
 * line, and never below `FACE_UP_OFFSET_MIN`. The face-down offset never
 * changes.
 */
export function faceUpOffsetFor(faces: readonly boolean[]): number {
  let faceUpGaps = 0;
  let faceDownGaps = 0;
  for (let i = 1; i < faces.length; i += 1) {
    if (faces[i - 1]) faceUpGaps += 1;
    else faceDownGaps += 1;
  }
  if (faceUpGaps === 0) return FACE_UP_OFFSET;

  const natural =
    TABLEAU_Y + faceDownGaps * FACE_DOWN_OFFSET + faceUpGaps * FACE_UP_OFFSET;
  if (natural + CARD_H <= COLUMN_BOTTOM_LIMIT) return FACE_UP_OFFSET;

  const room =
    COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y - faceDownGaps * FACE_DOWN_OFFSET;
  return Math.max(FACE_UP_OFFSET_MIN, room / faceUpGaps);
}

/** The top edge of the card at `row` of a column with these faces. */
export function columnCardY(faces: readonly boolean[], row: number): number {
  const faceUp = faceUpOffsetFor(faces);
  let y = TABLEAU_Y;
  for (let i = 1; i <= row && i < faces.length; i += 1) {
    y += faces[i - 1] ? faceUp : FACE_DOWN_OFFSET;
  }
  return y;
}

/** The top-left of the card at `row` of column `col`, given the column's faces. */
export function columnCardTopLeft(
  col: number,
  row: number,
  faces: readonly boolean[],
): Point {
  return { x: COLUMN_X[col], y: columnCardY(faces, row) };
}

/** The bottom edge of a column's lowest drawn card, or of its empty slot. */
export function columnBottom(faces: readonly boolean[]): number {
  if (faces.length === 0) return TABLEAU_Y + CARD_H;
  return columnCardY(faces, faces.length - 1) + CARD_H;
}

/**
 * The rectangle a pile answers a release inside (specs/table.md).
 *
 * Every pile but a column holding cards is a card-sized rectangle at its
 * anchor; a column holding cards is `CARD_W` wide, running from `TABLEAU_Y`
 * down to the bottom edge of its lowest drawn card, so `faces` is what a column
 * needs and what every other pile ignores.
 */
export function dropRectOf(
  pile: PileKind,
  index = 0,
  faces: readonly boolean[] = [],
): Rect {
  const { x, y } = pileTopLeft(pile, index);
  if (pile !== "tableau") return { x, y, w: CARD_W, h: CARD_H };
  return { x, y, w: CARD_W, h: columnBottom(faces) - TABLEAU_Y };
}

/**
 * How far right the waste's fan may reach (specs/table.md).
 *
 * Draw One shows one card, squared at the waste's anchor. Draw Three fans up to
 * three at a pitch of `26`, beginning at the anchor, and the specification caps
 * the fan's right edge here. It is stated in the harness rather than imported because the pitch is Draw
 * Three's own figure and this project serves both deal modes.
 */
const WASTE_FAN_RIGHT_LIMIT = 498;

/**
 * A point that lies on the waste's TOP card under EITHER deal mode.
 *
 * The waste's top card is the last of the cards it shows. Under Draw One that
 * card sits at the waste anchor, covering `346..446`; under Draw Three it sits
 * at the right end of the fan, whose right edge never passes
 * {@link WASTE_FAN_RIGHT_LIMIT}, so it covers at least `398..446`. That overlap
 * is on the top card whatever the mode and whatever the shown count, and it is
 * where a common check presses to lift the waste's top card.
 *
 * Pressing the waste ANCHOR's centre instead would land on an OLDER fanned card
 * under Draw Three, which lifts nothing (specs/controls.md), so a common check
 * that wants the top card presses here.
 */
export function wasteTopPoint(): Point {
  const left = WASTE_FAN_RIGHT_LIMIT - CARD_W;
  const right = WASTE_X + CARD_W;
  return { x: (left + right) / 2, y: TOP_ROW_Y + CARD_H / 2 };
}

/**
 * The point a press must land on to resolve to the card at `row` of column
 * `col` (specs/controls.md).
 *
 * A press resolves to the card drawn over every other card at its point, which
 * in a column is the LOWEST of the cards whose footprint contains it. So the
 * centre of a card that has cards below it is not on that card at all: the
 * point that reaches it is the band between its own top edge and the top edge of
 * the card below, which is what this returns. The column's lowest card has
 * nothing below it, so its centre is used.
 */
export function columnGrabPoint(
  faces: readonly boolean[],
  col: number,
  row: number,
): Point {
  const top = columnCardY(faces, row);
  if (row >= faces.length - 1) {
    return cardCenter(COLUMN_X[col], top);
  }
  const below = columnCardY(faces, row + 1);
  return { x: COLUMN_X[col] + CARD_W / 2, y: (top + below) / 2 };
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
 * comes from is this engine's business — the instance's `initialize` returns
 * it — and a fault that misdescribed the return would send a reviewer to the
 * wrong line of the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * The directory this file sits in, which is the validator project's root.
 *
 * Taken from this module's own URL and handed to the package, never derived
 * inside it: the harness package is staged one directory DEEPER than this file,
 * so a root taken there would address every replay and still one level too far
 * down — silently, because neither writer raises on a failed write.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The most calls {@link Harness.calls} holds before the oldest are dropped.
 *
 * A frame of this game is a few hundred calls, so this is hundreds of frames'
 * worth and no check that reads a picture can reach it: the way a check reads a
 * frame is {@link Harness.drawFrame}, which clears the log first and so is
 * always exact. The cap is for the checks that RUN rather than read — a whole
 * victory cascade at {@link CASCADE_HZ} is three thousand frames and several
 * million calls — so a suite that never looks at a call does not pay a gigabyte
 * of a worker's heap to keep them.
 *
 * The package's recorder keeps everything and is right to: the bound is a fact
 * about THIS case's longest sweep rather than about recording, which is why the
 * harnesses that carried one disagreed about the figure and most carried none.
 * `boundDrawLog` is where a case states its own.
 */
const MAX_RECORDED_CALLS = 100_000;

/** The engine this project stands a build up on. */
export type CascadeEngine = Engine<CascadeSurface>;

/**
 * The engine's own object model, which this project's checks reach past the
 * neutral contract for.
 *
 * Every member is a GETTER or a method over the live engine, so a check reads
 * what the engine holds now rather than what it held when the harness was built.
 */
interface WorldModel {
  /**
   * The world currently open, read fresh on every access. Cascade runs in ONE
   * world for the whole session — every screen is a value of the state's
   * `screen` field (specs/state.md) — but reading it through the engine keeps a
   * check honest against a build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `CascadeState` specs/state.md
   * declares — read fresh on every access. Its arrangement is the build's; what
   * a check asserts is read through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives the world. */
  readonly instance: GameInstance<CascadeSurface>;
  /** Forget every draw call recorded so far. */
  clearCalls(): void;
  /**
   * Clear the call log, run ONE frame, and hand back exactly the calls that
   * frame made.
   *
   * The move every check that reads a picture opens with: pose the table, then
   * `const calls = await h.drawFrame()`, and everything in `calls` was drawn by
   * the frame the pose produced and by nothing before it.
   */
  drawFrame(): Promise<DrawCall[]>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;
}

/**
 * The rate this harness's clock steps at, and the arithmetic that follows from
 * it.
 *
 * Separate from {@link WorldModel} because it is a fact about the OPTIONS a
 * harness was built with rather than about the engine, and the package's kit
 * hands its `extend` the engine and not the options. {@link createHarness} lays
 * these over the built harness, which is the only place the rate is known.
 */
interface RateModel {
  /** The frames per second of the clock currently installed. */
  readonly hz: number;
  /** Run whole frames of this harness's clock covering `duration` seconds. */
  advanceSeconds(duration: number): Promise<void>;
  /** Frames of this harness's clock covering `duration` seconds. */
  framesFor(duration: number): number;
  /** Seconds of game time in `frames` frames of this harness's clock. */
  secondsFor(frames: number): number;
}

/**
 * The package's engine machinery, bound to Cascade on this engine.
 *
 * Everything the four engines disagree about is answered here from what THIS
 * engine is:
 *
 *  - `driver` is the IDENTITY strategy. This engine's surface is already
 *    imperative, so the object the build returned is what a check calls, and
 *    naming the strategy is what says so.
 *  - `toLogical` goes through the open world's CAMERA, which is where this
 *    engine's logical space is decided. The camera opens at the defaults — world
 *    and logical coordinates coincide, which is the space every figure the
 *    specification fixes is stated in — so the projection is the identity unless
 *    the build moved it, and mapping through it keeps a reading honest either
 *    way.
 *  - `pointerPrecision` stays `"exact"`, so a raised pointer lands exactly where
 *    the caller asked rather than on the nearest device pixel; every gesture
 *    below aims at a point the case's geometry or the BUILD's own reported
 *    region names, and rounding that aim would be this harness moving the shot.
 *  - `pointerEvent` is left at the package's default, the POSITION-only event:
 *    specs/controls.md gives the menus different rules for a mouse and a finger,
 *    but this engine resolves both into the same press, move and release, so a
 *    check here poses a position and the engine applies its own defaults for the
 *    rest — which is what every verdict in this project was taken under.
 */
const kit = createEngineCaseHarness<
  CascadeSnapshot,
  CascadeDriver,
  CascadeEngine,
  WorldModel
>({
  slug: "cascade",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // Every text call carries the width the canvas measured for it and the
  // alignment in force, which is what {@link drawnTextSpans} turns into the run's
  // span. Cascade reads WHERE a label landed — `presentation/hud-labels-drawn`
  // holds a drawn run against the region the build reported for it — and an
  // anchor alone cannot answer that.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(1000 / TICK_HZ),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<CascadeSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own table background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it, so the letterbox bars match the felt
      // (specs/overview.md). Cascade registers no actions and selects no touch
      // layout (specs/controls.md), so neither is passed here either.
      background: BACKGROUND,
      clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (_engine, raw) => identityDriver(raw as CascadeDriver),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  extend: (base, engine, initialized) => ({
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance: initialized as GameInstance<CascadeSurface>,
    clearCalls: () => {
      base.calls.length = 0;
    },
    async drawFrame() {
      base.calls.length = 0;
      await base.advance(1);
      return [...base.calls];
    },
    async runFor(ms: number) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, ms));
      controller.abort();
      await running;
    },
  }),
});

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<
  CascadeSnapshot,
  CascadeDriver,
  CascadeEngine
> &
  WorldModel &
  RateModel;

/** The window a harness reports to the engine, and the clock it steps on. */
export interface HarnessOptions extends EngineHarnessOptions {
  /**
   * Frames per second of the harness's `ConstantClock`. Defaults to
   * {@link TICK_HZ}, and is ignored when the caller hands in a `clock` of its
   * own.
   */
  hz?: number;
}

/** One cue the build played, stamped with the frame it sounded on. */
export type { TimedCue };
export type PlayedCue = TimedCue;

/* The vocabulary this project's suites read a frame's render in, straight off
   the package: one recorded operation, and a point on the stage. */
export type { DrawCall, Point };

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize`
 * rejected fails with the engine's own message rather than with a teardown error
 * on top of it.
 *
 * Two things this adds to the package's own factory. The bound on the draw log —
 * see {@link MAX_RECORDED_CALLS} — has to be put on the harness that was just
 * built, because the log is the recorder's array and the bound is Cascade's. And
 * the rate members are laid on here because the RATE is a fact about these
 * options rather than about the engine the kit's `extend` is handed.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const hz = options.hz ?? TICK_HZ;
  const h = await kit.createHarness({
    ...options,
    clock: options.clock ?? new ConstantClock(1000 / hz),
  });
  boundDrawLog(h.calls, MAX_RECORDED_CALLS);
  return Object.assign(h, {
    hz,
    advanceSeconds: (duration: number) => h.advance(framesFor(duration, hz)),
    framesFor: (duration: number) => framesFor(duration, hz),
    secondsFor: (frames: number) => secondsFor(frames, hz),
  });
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare its OUTPUTS beside its verdict: a `replay`, the
// frames the build itself drew while a check drove it, kept as evidence a
// reviewer can scrub against the reference implementation's, or an `image`, one
// frame of it. Both writers are the package's, bound here to this case's slug and
// to THIS directory, and both are evidence and never a verdict: the scenario's
// own value comes straight back, a scenario that throws still leaves what it
// recorded, a capture that closed no frames writes nothing, and outside a run the
// media directory is unset and the whole thing is a no-op that still runs the
// scenario.
//
// ARM A REPLAY NARROWLY. The victory cascade blits a full-screen painted layer
// every frame, and the recorder captures a source whose content can change at
// every use, so a recording armed around a whole cascade with the trail painting
// on buys a reviewer nothing and can cost the frames the check was about. Every
// `replay` in the `cascade` group therefore runs with `setTrailPainting(false)`,
// and the ones in `winning` cover the win and the cascade's first frames alone.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const run = await captureReplay(h, "bounce", () =>
 *   h.until((seen) => seen.flyers[0].vy < 0, { maxFrames: 240 }),
 * );
 * assertTrue(run.hit);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("cascade", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the table a deal laid out, which
 * screen the game opened on, where a column's cards were fanned. A recording of a
 * still table would be the same frame three hundred times over.
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
// Each of these poses a situation through the debug surface — or drives the real
// pointer path — and then lets the build's own rules run. They fix only
// arrangement: which column a card sits on, which foundations are complete,
// where the pointer went. Every threshold a check asserts is stated in the check
// itself, derived from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no table, and a check
// about a foundation poses no stock.

/**
 * `reset({seed})`: the title screen, a seeded generator, every declared field at
 * its title-screen value. Every suite's opening move.
 *
 * No frame is advanced. A pose acts on the live game at the call under this
 * engine (specs/instrumentation.md), so the state is restored when this returns,
 * and a check about what `reset` restores — `simTime` among them — reads a game
 * that has run no frame since. `muted` is left exactly as it stands, because
 * muting is a player preference the runtime owns.
 */
export function resetTo(h: Harness, seed?: number): void {
  h.debug.reset(seed === undefined ? undefined : { seed });
}

/**
 * Live play on an EMPTY table: `reset`, the `playing` screen, and every one of
 * the thirteen piles cleared along with the waste's set memory.
 *
 * This is the ground almost every mechanical check stands on, and it is a
 * harness sequence rather than a debug operation because the surface is atomic:
 * every line below is one of its operations.
 *
 * THE FOUR GATES ARE LEFT ON, at the values `reset` restores. Cascade has no
 * autonomous entity and nothing arrives uninvited — no card is dealt, turned or
 * moved except by something the scenario does — so an empty table is already an
 * isolated world and a scenario needs no gate held down to keep it still. A
 * check turns ONE gate off when that gate is its own requirement, or when its
 * requirement would otherwise be entangled with another rule: `setAutoFlip` to
 * watch a column that must NOT turn, `setWinDetect` to complete fifty-two
 * without the game ending, `setLaunching` to hold a cascade at the cards already
 * in flight, `setTrailPainting` to keep a full-screen blit out of a recording.
 *
 * The generator is seeded, so a check that wants a particular deal passes its
 * own seed. No frame is advanced: every pose here lands at the call.
 */
export function openTable(h: Harness, seed?: number): void {
  resetTo(h, seed);
  h.debug.setScreen("playing");
  h.debug.clearTable();
}

/**
 * Pose one of the other three screens, over an empty table.
 *
 * {@link openTable}'s siblings, built out of the same three atomic operations in
 * the same order: `reset()`, `setScreen(...)`, `clearTable()`
 * (specs/instrumentation.md).
 *
 * WHY `setScreen` RATHER THAN THE ROUTE A PLAYER TAKES. A check about what the
 * how-to screen draws, or about the key that leaves it, must not fail because the
 * title's `HOW TO PLAY` control is broken — `screens/title-how-to-opens` is the
 * item that grades that control. So a check poses the screen it is about
 * directly, and only a check whose subject IS a control presses one.
 *
 * WHY THE TABLE IS CLEARED. specs/screens.md lets the table show behind the title
 * and how-to screens, "dimmed or otherwise quieted", so what sits behind the copy
 * is the build's. Clearing it is the isolation rule: the world holds only what
 * the requirement concerns.
 *
 * They pose and return; they run no frame.
 */
export function openTitle(h: Harness): void {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.clearTable();
}

/** The how-to screen, over an empty table. */
export function openHowto(h: Harness): void {
  resetTo(h);
  h.debug.setScreen("howto");
  h.debug.clearTable();
}

/** The `won` screen, over an empty table, with nothing in flight. */
export function openWon(h: Harness): void {
  resetTo(h);
  h.debug.setScreen("won");
  h.debug.clearTable();
}

/**
 * A fresh game in play: `reset`, the `playing` screen, and the game's own
 * `deal`.
 *
 * The deal is the build's, run through the same path a new game runs through
 * (specs/deal.md), so what stands on the table when this returns is whatever the
 * build's own shuffle and deal produced from the seed.
 */
export function dealInPlay(h: Harness, seed?: number): void {
  resetTo(h, seed);
  h.debug.setScreen("playing");
  h.debug.deal();
}

/**
 * One card on the top of a pile, and its id.
 *
 * The id comes off the snapshot's last card in that pile, which is where an
 * added card lands (specs/instrumentation.md, Identity). A build whose `addCard`
 * added nothing fails here, naming the operation.
 */
export function poseCard(
  h: Harness,
  pile: PileKind,
  index: number,
  spec: CardSpec,
): number {
  h.debug.addCard(pile, index, spec.suit, spec.rank, spec.faceUp ?? true);
  const cards = pileOf(h.snapshot(), pile, index);
  if (cards.length === 0) {
    fail(
      `addCard(${JSON.stringify(pile)}, ${index}, ` +
        `${JSON.stringify(spec.suit)}, ${spec.rank}, ${spec.faceUp ?? true}) ` +
        `to append the card to that pile (specs/instrumentation.md)`,
      `the ${pile} pile is empty`,
    );
  }
  return cards[cards.length - 1].id;
}

/**
 * A column posed bottom card first, and the ids in the same order.
 *
 * `cards[0]` is the column's bottom-most card, the one drawn highest on the
 * table, and the last entry is its exposed card — the one a run is stacked onto
 * and the one a move takes first (specs/table.md). Each card is face-up unless
 * its spec says otherwise.
 */
export function poseColumn(
  h: Harness,
  column: number,
  cards: readonly CardSpec[],
): number[] {
  return cards.map((spec) => poseCard(h, "tableau", column, spec));
}

/**
 * One foundation built from its Ace up to `upTo`, all face-up, and the ids in
 * rank order.
 *
 * The cards are posed one at a time, so the foundation ends holding exactly the
 * pile a legally built one holds.
 */
export function poseFoundation(
  h: Harness,
  index: number,
  suit: Suit,
  upTo: number,
): number[] {
  const ids: number[] = [];
  for (let rank = 1; rank <= upTo; rank += 1) {
    ids.push(poseCard(h, "foundation", index, { suit, rank, faceUp: true }));
  }
  return ids;
}

/**
 * The waste: its cards bottom-first, then its SETS oldest-first, and the card
 * ids in the order they were given.
 *
 * The set memory is never omitted, because a waste's cards and the sets it
 * remembers are two different things (specs/stock.md): the cards on the waste
 * belong to those sets from the bottom up, the waste SHOWS the cards on the
 * newest set that still holds any, and a waste whose memory is empty shows no
 * card and offers none to play whatever cards it still holds. A pose whose sets
 * ran to more cards than were given would describe a waste that cannot exist, so
 * it is refused here rather than posed.
 */
export function poseWaste(
  h: Harness,
  cards: readonly CardSpec[],
  sets: readonly number[],
): number[] {
  const total = sets.reduce((sum, count) => sum + count, 0);
  if (total > cards.length) {
    throw new Error(
      `poseWaste: ${total} cards across ${sets.length} sets, over the ` +
        `${cards.length} cards given`,
    );
  }
  const ids = cards.map((spec) => poseCard(h, "waste", 0, spec));
  for (const count of sets) h.debug.addWasteSet(count);
  return ids;
}

/**
 * The stock, bottom card first, so the LAST card given is the one the next turn
 * takes.
 *
 * A dealt stock is face-down (specs/deal.md), so that is the face a spec that
 * says nothing gets here — the one pose whose default differs from the rest.
 * A spec that names its face keeps it.
 */
export function poseStock(h: Harness, cards: readonly CardSpec[]): number[] {
  return cards.map((spec) =>
    poseCard(h, "stock", 0, { ...spec, faceUp: spec.faceUp ?? false }),
  );
}

/** One card in flight, and its id. */
export function poseFlyer(
  h: Harness,
  spec: { suit: Suit; rank: number },
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  h.debug.addFlyer(spec.suit, spec.rank, x, y, vx, vy);
  const flyers = h.snapshot().flyers;
  if (flyers.length === 0) {
    fail(
      `addFlyer(${JSON.stringify(spec.suit)}, ${spec.rank}, ${x}, ${y}, ` +
        `${vx}, ${vy}) to append a card to the flight ` +
        `(specs/instrumentation.md)`,
      "the flyer list is empty",
    );
  }
  return flyers[flyers.length - 1].id;
}

/** Where the one card a nearly-won table is missing was left. */
export interface NearlyWon {
  /** The suit whose foundation is one card short. */
  suit: Suit;
  /** The index of that foundation. */
  foundation: number;
  /** The column the missing King was posed on. */
  column: number;
  /** Its row in that column, counted from the bottom. */
  row: number;
  /** The King's own id. */
  id: number;
}

/**
 * Every foundation complete, Ace to King, except one held at its Queen — with
 * that suit's King posed on a column instead, one legal move from winning.
 *
 * The table is otherwise EMPTY: the stock, the waste, the other six columns and
 * the waste's set memory are all cleared first, so the fifty-second card is the
 * only card outside the foundations and nothing else on the table can move.
 * `openTable` is called for you, so a check that wants a seed passes one.
 */
export function poseNearlyWon(
  h: Harness,
  options: { suit?: Suit; column?: number; seed?: number } = {},
): NearlyWon {
  const suit = options.suit ?? "clubs";
  const column = options.column ?? 0;
  openTable(h, options.seed);

  // One foundation per suit, in the order a deck is built. Which suit sits on
  // which foundation is arbitrary — any suit may start any foundation
  // (specs/foundations.md) — so the deck's own order is used and the index the
  // named suit landed on comes back with the rest.
  let foundation = 0;
  ALL_SUITS.forEach((each, index) => {
    if (each === suit) foundation = index;
    poseFoundation(h, index, each, each === suit ? 12 : 13);
  });

  const id = poseCard(h, "tableau", column, { suit, rank: 13, faceUp: true });
  const row = pileOf(h.snapshot(), "tableau", column).length - 1;
  return { suit, foundation, column, row, id };
}

/**
 * A running victory cascade, entered through the game's OWN win path.
 *
 * {@link poseNearlyWon}, then the last King moved home with `move` — the same
 * operation a released drop applies through — so the win test, the move to the
 * `won` screen and the cascade's first frame all happen because the game decided
 * they should. Nothing here poses `screen`, `launched` or a flyer.
 *
 * A build that refused the move never reaches a cascade at all, so the refusal
 * is reported here rather than left to surface as an empty flyer list.
 */
export function startCascade(
  h: Harness,
  options: { suit?: Suit; column?: number; seed?: number } = {},
): NearlyWon {
  const posed = poseNearlyWon(h, options);
  const accepted = h.debug.move(
    "tableau",
    posed.column,
    posed.row,
    "foundation",
    posed.foundation,
  );
  if (!accepted) {
    fail(
      `move() to accept the ${posed.suit} King onto its own foundation ` +
        `holding that suit's Queen (specs/foundations.md)`,
      "the move was refused",
    );
  }
  return posed;
}

/* ---- Driving the pointer -------------------------------------------------- */
//
// Every gesture below goes through the debug surface's pointer operations, which
// feed the same input path a player's pointer feeds and take effect before the
// call returns (specs/instrumentation.md): the hit test, the grab rule, the drop
// rule and the double-click rule all run exactly as they do for a player, and no
// frame has to be advanced for a gesture to land. {@link Harness.pointer} is the
// other way in, for the one check whose subject is the sample list itself.

/** A press at a logical stage point. */
export function pressAt(h: Harness, x: number, y: number): void {
  h.debug.pointerDown(x, y);
}

/** A pointer move to a logical stage point. */
export function movePointerTo(h: Harness, x: number, y: number): void {
  h.debug.pointerMove(x, y);
}

/** A release at a logical stage point. */
export function releaseAt(h: Harness, x: number, y: number): void {
  h.debug.pointerUp(x, y);
}

/**
 * A CLICK: a press and a release at the same point, which lies zero units from
 * the press and is therefore inside `DRAG_THRESHOLD` (specs/controls.md).
 *
 * A click returns any held run to where it was lifted from, activates the
 * control its press landed in, and turns the stock when its press landed there.
 */
export function clickAt(h: Harness, x: number, y: number): void {
  h.debug.pointerDown(x, y);
  h.debug.pointerUp(x, y);
}

/** A click at the centre of a control's rectangle (specs/controls.md). */
export function clickControl(h: Harness, rect: Rect): void {
  const { x, y } = rectCenter(rect);
  clickAt(h, x, y);
}

/**
 * Two clicks at the same point with NO game time between them, which is a double
 * click by every one of the three conditions specs/controls.md states — inside
 * the window, inside the slop, and on whatever card the point lands on.
 *
 * A check about the window or the slop drives two {@link clickAt} calls of its
 * own with the separation it is about between them.
 */
export function doubleClickAt(h: Harness, x: number, y: number): void {
  clickAt(h, x, y);
  clickAt(h, x, y);
}

/**
 * A DROP: a press at `from`, `steps` moves interpolated to `to`, and a release
 * there.
 *
 * The intermediate moves are what a real gesture delivers, and they are what
 * gives `dropTarget` its chance to be recomputed as the run travels. Whether the
 * gesture is a drop or a click is decided by how far `to` lies from `from`
 * (specs/controls.md); this helper takes the caller's word for both and asserts
 * nothing about the distance, so a check about the threshold drives a short one
 * deliberately.
 */
export function drag(h: Harness, from: Point, to: Point, steps = 8): void {
  h.debug.pointerDown(from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    h.debug.pointerMove(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
  }
  h.debug.pointerUp(to.x, to.y);
}

/**
 * The same gesture delivered to the REAL pointer, all of it between two frames,
 * and then the one frame that carries it.
 *
 * Every sample dispatched here arrives in the next frame's sample list, in the
 * order it was dispatched, so a build that answers every sample lifts the run
 * and completes the drop while a build that keeps only the frame's last sample
 * sees the release alone and has nothing in hand. That difference is the whole
 * of `handling.sweep-resolves-per-sample`, and this is the only helper that
 * drives it.
 */
export async function dragThroughEvents(
  h: Harness,
  from: Point,
  to: Point,
  steps = 8,
): Promise<void> {
  h.pointer("pointerdown", from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    h.pointer(
      "pointermove",
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
  }
  h.pointer("pointerup", to.x, to.y);
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* Reading the snapshot                                                       */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned, so a check reads what
// it is about without walking thirteen piles by hand. None of them asserts
// anything: a reading that is not there comes back `undefined` or empty, and
// what that means is the check's to state.

/** The named pile, bottom to top. An index off the end reads as empty. */
export function pileOf(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): SnapshotCard[] {
  switch (pile) {
    case "stock":
      return snapshot.stock;
    case "waste":
      return snapshot.waste;
    case "foundation":
      return snapshot.foundations[index] ?? [];
    case "tableau":
      return snapshot.tableau[index] ?? [];
  }
}

/** A pile's top card — the last entry — or `undefined` where it holds none. */
export function topOf(pile: readonly SnapshotCard[]): SnapshotCard | undefined {
  return pile[pile.length - 1];
}

/** The card at `row` of a pile, counted from the bottom. */
export function cardAt(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
  row: number,
): SnapshotCard | undefined {
  return pileOf(snapshot, pile, index)[row];
}

/** Where one card sits: the pile that holds it and its row from the bottom. */
export interface CardSite {
  card: SnapshotCard;
  pile: PileKind;
  index: number;
  row: number;
}

/** Every card on the table, with where it sits, in pile order. */
export function everyCard(snapshot: CascadeSnapshot): CardSite[] {
  const sites: CardSite[] = [];
  const walk = (pile: PileKind, index: number): void => {
    pileOf(snapshot, pile, index).forEach((card, row) => {
      sites.push({ card, pile, index, row });
    });
  };
  walk("stock", 0);
  walk("waste", 0);
  for (const index of FOUNDATIONS) walk("foundation", index);
  for (const index of COLUMNS) walk("tableau", index);
  return sites;
}

/** Where the card with that id is now, or `undefined` where none carries it. */
export function siteOf(
  snapshot: CascadeSnapshot,
  id: number,
): CardSite | undefined {
  return everyCard(snapshot).find((site) => site.card.id === id);
}

/** The card with that id, or `undefined` where none carries it. */
export function cardById(
  snapshot: CascadeSnapshot,
  id: number,
): SnapshotCard | undefined {
  return siteOf(snapshot, id)?.card;
}

/** The flyer with that id, or `undefined` where none carries it. */
export function flyerById(
  snapshot: CascadeSnapshot,
  id: number,
): SnapshotFlyer | undefined {
  return snapshot.flyers.find((flyer) => flyer.id === id);
}

/** How many cards are home across the four foundations. */
export function cardsHome(snapshot: CascadeSnapshot): number {
  return snapshot.foundations.reduce((sum, pile) => sum + pile.length, 0);
}

/** Whether each card of a column is face-up, bottom row first. */
export function columnFaces(
  snapshot: CascadeSnapshot,
  column: number,
): boolean[] {
  return pileOf(snapshot, "tableau", column).map((card) => card.faceUp);
}

/**
 * The cards the waste SHOWS, bottom-most first, so the last of them is its top
 * card (specs/stock.md).
 *
 * The count comes from `wasteVisibleCount`, which the build reports, and is
 * capped at the cards the waste actually holds — so a build reporting more shown
 * than it holds reads as showing all of them rather than throwing here.
 */
export function wasteShown(snapshot: CascadeSnapshot): SnapshotCard[] {
  const count = Math.min(snapshot.wasteVisibleCount, snapshot.waste.length);
  return count <= 0 ? [] : snapshot.waste.slice(snapshot.waste.length - count);
}

/** The top-left a card is drawn at, wherever in the table it sits. */
export function cardTopLeft(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
  row: number,
): Point {
  if (pile !== "tableau") return pileTopLeft(pile, index);
  return columnCardTopLeft(index, row, columnFaces(snapshot, index));
}

/**
 * The point a press must land on to reach the card at `row` of column `column`,
 * read off the table as it stands. {@link columnGrabPoint} against the column's
 * own faces.
 */
export function grabPoint(
  snapshot: CascadeSnapshot,
  column: number,
  row: number,
): Point {
  return columnGrabPoint(columnFaces(snapshot, column), column, row);
}

/** The rectangle a pile answers a release inside, read off the table as it stands. */
export function dropRectIn(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): Rect {
  return dropRectOf(
    pile,
    index,
    pile === "tableau" ? columnFaces(snapshot, index) : [],
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
 *
 * A cue raised by an operation the check called between frames — a `move`, a
 * `turnStock`, a press — is played at the call, so it lands here with the frame
 * count as it stood when the operation ran.
 *
 * A LOOP IS NOT A PLAY, and this project counts plays: the kit subscribes
 * `cue:played` alone, which is what every cue point here was decided under. The
 * cue NAMES are `CUES` in this project's own `constants.ts`, transcribed from the
 * table in specs/audio.md, which also says which event each one belongs to.
 */
export const watchCues = kit.watchCues;

/** Every recorded firing of the cue named `name`, oldest first. */
export const cuesNamed = kit.cuesNamed;

/** Forget every cue recorded so far, so a check reads its own section alone. */
export const clearCues = kit.clearCues;
/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no colour and no typeface,
// only what a player must be able to tell apart, so nothing here knows a colour
// and every reading below compares what was painted against what else was
// painted.

/** A sampled colour, each channel 0–255. */
export type { Rgb };

/** Euclidean distance between two colours, 0 to about 441. */
export { colorDistance };

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out — well inside a
 * `100 x 140` card — so one stray anti-aliased pixel, or the hairline of a
 * border, cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleClusterColor(h, x, y);
}

/** The rendered colour at the middle of a card drawn with its top-left there. */
export function sampleCard(h: Harness, x: number, y: number): Rgb {
  const centre = cardCenter(x, y);
  return sampleColor(h, centre.x, centre.y);
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the same
 * canvas implementation the harness samples with, so a pixel the game never drew
 * over compares against it exactly.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterize(BACKGROUND);
  return { r, g, b };
}

/**
 * How many bytes differ between two rasters of the same shape.
 *
 * The package's whole-frame reading, under this project's name for it: any
 * difference counts and the size of it does not, which is the question "did the
 * build draw anything different at all" and NOT the tolerance-bearing
 * `pixelsDiffering` next to it in the package.
 */
export const pixelsChanged = pixelBytesChanged;

/** Every pixel inside a logical rectangle, as RGBA bytes. */
export function regionPixels(h: Harness, rect: Rect): Uint8ClampedArray {
  const from = h.device(rect.x, rect.y);
  const to = h.device(rect.x + rect.w, rect.y + rect.h);
  const width = Math.max(1, to.x - from.x);
  const height = Math.max(1, to.y - from.y);
  return Uint8ClampedArray.from(
    h.ctx.getImageData(from.x, from.y, width, height).data,
  );
}

/**
 * What fraction of a logical rectangle's pixels sit farther than `tolerance`
 * from `colour` — the reading a check about how much of the table has been
 * covered takes.
 *
 * The tolerance and the bound the fraction is held to are both the check's: this
 * counts, and says nothing about how much is enough.
 */
export function fractionUnlike(
  h: Harness,
  rect: Rect,
  colour: Rgb,
  tolerance: number,
): number {
  const data = regionPixels(h, rect);
  if (data.length === 0) return 0;
  let unlike = 0;
  for (let i = 0; i < data.length; i += 4) {
    const sample = rgbOf([data[i], data[i + 1], data[i + 2], data[i + 3]]);
    if (colorDistance(sample, colour) > tolerance) unlike += 1;
  }
  return unlike / (data.length / 4);
}
/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */
//
// {@link Harness.drawFrame} is how a check gets a frame's calls: it clears the
// log, runs one frame, and hands back exactly what that frame drew. Everything
// below reads such a list, mapping whatever space a call was made in back to the
// stage's logical units through the transform in force at the call and the
// engine's own fit — so a build that draws under a translation of its own is
// read at the position a player sees, not at the numbers it happened to pass.

/**
 * Every string the frame drew, through `fillText` or `strokeText`.
 *
 * The package's reading, under this project's name for it: the RAW strings, one
 * per call, in the order `fillText` then `strokeText`.
 */
export const drawnText = rawDrawnText;

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a label is
 * commonly drawn with a marker or padding around it. Requiring the exact run
 * would fail a screen that shows precisely the right words.
 *
 * READ OFF THE RAW CALLS, WHICH IS NOT WHAT THE PACKAGE'S `drewText` READS. The
 * package's spells the frame's text into LOGICAL RUNS first, so a heading drawn
 * a glyph per `fillText` reads as the word it spells; this one asks whether some
 * single call carried the copy. The two agree on every build that draws a label
 * in one call and disagree on one that does not, so binding the package's here
 * would quietly widen what this project's `screens` and `presentation` points
 * accept. Cascade's engineless project binds the package's; these two do not,
 * and that difference is recorded in the README's collision table.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * WHERE THE TRANSFORM COMES FROM, AND WHY IT IS WALKED RATHER THAN READ. The
 * package's recorder records the transform beside a TEXT call, because that is
 * the one reading whose extent depends on the font as well as on the geometry;
 * for every other call it records the arguments the build passed and nothing
 * else. So a reading that places a SHAPE carries the transform itself, exactly
 * as the package's own `textDraws` does for an unmeasured call: `save` pushes,
 * `restore` pops, and everything `transformed` knows about composes. That
 * reproduces `getTransform()` at every placed call in this project's frames —
 * the engine's own fit is issued through the same recorded context, so the walk
 * sees it too.
 */
function walkTransforms(
  calls: readonly DrawCall[],
  visit: (call: DrawCall, m: Matrix) => void,
): void {
  const saved: Matrix[] = [];
  let current: Matrix = IDENTITY;
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
    } else {
      current = transformed(current, method, args) ?? current;
    }
    visit(call, current);
  }
}

/** One shape a frame painted, as the box it covers in logical units. */
export interface DrawnShape {
  /**
   * The call that painted it: `fill` or `stroke` for a path, or `fillRect`,
   * `strokeRect` or `clearRect` for a rectangle drawn in one call.
   */
  method: string;
  /** The top-left of the box the shape covers, in logical units. */
  x: number;
  y: number;
  /** The size of that box, in logical units, always positive. */
  w: number;
  h: number;
}

/**
 * Every shape the frame painted, each as the box it covers in logical units.
 *
 * THIS IS HOW A CHECK READS WHERE THE BUILD DREW A CARD. A card occupies a
 * `CARD_W x CARD_H` rectangle at its top-left wherever it sits (specs/table.md),
 * but the CALL a build draws it with is the build's own: `fillRect` from one
 * build, a hand-built rounded-corner path of lines and curves from another, and
 * both are the same card in the same place to a player. So the path is followed
 * — every point the build named, mapped through the transform in force when it
 * was named and then back through the engine's fit — and what comes back is the
 * box each `fill` or `stroke` covered. A rounded rectangle's control points are
 * its own corners, so its box is exactly the footprint it drew.
 *
 * A path is not cleared by painting it: a canvas keeps the current path across
 * `fill` and `stroke`, so a build that fills and then strokes the same outline
 * reports two shapes over the same box, which is the truthful reading of what it
 * drew. `beginPath` starts a new one.
 *
 * Two things it cannot see, both of them rare and neither of them how this
 * game's picture is made: a shape drawn through a `Path2D` built outside the
 * context, and the exact outline of a partial `arc`, whose box is taken from the
 * whole circle.
 */
export function drawnShapes(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnShape[] {
  const view = h.viewport();
  const shapes: DrawnShape[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const clear = (): void => {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
  };

  const cover = (m: Matrix, x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const at = apply(m, x, y);
    const px = (at.x - view.offsetX) / view.scale;
    const py = (at.y - view.offsetY) / view.scale;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };

  const emit = (method: string): void => {
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
    shapes.push({
      method,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    });
  };

  /** One rectangle painted in a single call, which leaves the path alone. */
  const rectangle = (method: string, m: Matrix, args: unknown[]): void => {
    const kept = { minX, minY, maxX, maxY };
    clear();
    const [rx, ry, rw, rh] = args.map((value) =>
      typeof value === "number" ? value : NaN,
    );
    cover(m, rx, ry);
    cover(m, rx + rw, ry + rh);
    emit(method);
    ({ minX, minY, maxX, maxY } = kept);
  };

  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    if (method === "beginPath") {
      clear();
      return;
    }
    if (method === "fill" || method === "stroke") {
      emit(method);
      return;
    }
    const n = args.map((value) => (typeof value === "number" ? value : NaN));
    switch (method) {
      case "fillRect":
      case "strokeRect":
      case "clearRect":
        rectangle(method, m, args);
        break;
      case "rect":
      case "roundRect":
        cover(m, n[0], n[1]);
        cover(m, n[0] + n[2], n[1] + n[3]);
        break;
      case "moveTo":
      case "lineTo":
        cover(m, n[0], n[1]);
        break;
      case "arcTo":
      case "quadraticCurveTo":
        cover(m, n[0], n[1]);
        cover(m, n[2], n[3]);
        break;
      case "bezierCurveTo":
        cover(m, n[0], n[1]);
        cover(m, n[2], n[3]);
        cover(m, n[4], n[5]);
        break;
      case "arc":
        cover(m, n[0] - n[2], n[1] - n[2]);
        cover(m, n[0] + n[2], n[1] + n[2]);
        break;
      case "ellipse":
        cover(m, n[0] - n[2], n[1] - n[3]);
        cover(m, n[0] + n[2], n[1] + n[3]);
        break;
      default:
        break;
    }
  });
  return shapes;
}

/**
 * The shapes among `shapes` whose top-left lies within `tolerance` of a point —
 * everything a build stacked at one anchor, in the order it painted them.
 *
 * What SIZE counts as a card is the check's to state: a card is
 * `CARD_W x CARD_H` (specs/table.md), and a check that wants the card rather
 * than the pip drawn on it filters on that figure itself.
 */
export function shapesAt(
  shapes: readonly DrawnShape[],
  x: number,
  y: number,
  tolerance = 1,
): DrawnShape[] {
  return shapes.filter(
    (shape) =>
      Math.abs(shape.x - x) <= tolerance && Math.abs(shape.y - y) <= tolerance,
  );
}

/** One bitmap a frame blitted, placed in logical units. */
export interface DrawnImage {
  /** The source the build handed the context. */
  source: { width: number; height: number };
  /** The destination rectangle's top-left, in logical units. */
  x: number;
  y: number;
  /** The destination rectangle's size, in logical units, always positive. */
  w: number;
  h: number;
}

/**
 * Every bitmap the frame blitted, with its destination placed in logical units.
 *
 * The one blit this game makes is the painted layer, drawn stage-sized beneath
 * the cards still on the foundations (specs/victory.md), so this is how a check
 * sees that the layer was put on the table at all. The three-argument form takes
 * its size from the source's own dimensions, which is what the canvas does with
 * it.
 *
 * The SOURCE is read off the call's own first argument rather than through the
 * package's `imageRef` interning, because what this reads is the layer's SIZE —
 * a stage-sized bitmap rather than a sprite — and the case interns nothing.
 */
export function drawnImages(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnImage[] {
  const view = h.viewport();
  const images: DrawnImage[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call" || call.method !== "drawImage") return;
    const source = call.args[0] as { width?: unknown; height?: unknown } | null;
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.width !== "number" ||
      typeof source.height !== "number"
    ) {
      return;
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
      return;
    }
    if (![dx, dy, dw, dh].every(Number.isFinite)) return;

    const at = apply(m, Math.min(dx, dx + dw), Math.min(dy, dy + dh));
    images.push({
      source: source as { width: number; height: number },
      x: (at.x - view.offsetX) / view.scale,
      y: (at.y - view.offsetY) / view.scale,
      w: (Math.abs(dw) * Math.hypot(m[0], m[1])) / view.scale,
      h: (Math.abs(dh) * Math.hypot(m[2], m[3])) / view.scale,
    });
  });
  return images;
}

/**
 * One run of text a frame drew, and the logical x range its glyphs span.
 *
 * The package's `TextDraw`, under this project's name for it. It carries the
 * alignment in force at the draw as well, which no check here reads.
 */
export type TextSpan = TextDraw;

/**
 * Every run of text `calls` drew, placed in logical units.
 *
 * A build may anchor its text through any `translate`/`scale` it likes and align
 * it any way it likes, so the anchor is mapped through the transform the context
 * held at the call and the run is extended about it by its measured width and
 * `textAlign`; the extent is then carried back through the engine's fit into the
 * stage's own units. Which way a `start`/`end` alignment reads is the page's
 * direction; this game draws no right-to-left text, so they are left and right.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws it
 * through the same context, in device pixels under an identity transform, which
 * this mapping carries back to logical units like any other run.
 *
 * ONE ENTRY PER CALL, never merged: a check here holds a drawn label against the
 * region the build reported for it, and a merged run is wider than any of its
 * members.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(calls));
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
 * diagnostics.md), and Cascade registers no action at all (specs/controls.md).
 * It is drawn after the pipeline renders, through the same context this harness
 * records — so with the overlay up, the sources the build registered land among
 * the returned calls as ordinary text draws, readable with {@link drawnText} —
 * but AFTER the engine recorder's bracket closes, so none of it appears in a
 * {@link captureReplay} recording. Capture overlay evidence with
 * {@link captureStill}.
 *
 * What comes back is that one frame's calls alone, exactly as
 * {@link Harness.drawFrame} hands them over, so two toggles are compared
 * against each other rather than against everything drawn before them.
 */
export async function toggleOverlay(h: Harness): Promise<DrawCall[]> {
  h.hold("Backquote");
  h.release("Backquote");
  return h.drawFrame();
}

/* -------------------------------------------------------------------------- */
/* The menus                                                                  */
/* -------------------------------------------------------------------------- */
//
// WHERE AN ITEM SITS IS THE BUILD'S, AND IS ASKED FOR RATHER THAN ASSUMED.
// specs/controls.md leaves each control's hit region to the build — "Each control
// occupies a rectangular hit region the build lays out" — and
// specs/instrumentation.md has the build report it through `menuItemRect`. So
// every gesture below is aimed at the middle of what the build answered with,
// which is what lets any layout pass and fails only a build that reports a region
// it does not answer on. NOTHING HERE IMPORTS A CONTROL RECTANGLE, and nothing
// may: `./constants.ts` fixes the ORDER of a screen's items and no position.
//
// EVERY GESTURE GOES THROUGH THE ENGINE'S OWN INPUT, never through the surface's
// pointer poses. specs/controls.md gives the mouse and the finger DIFFERENT menu
// rules — a mouse selects the item it moves onto, and a finger, which never
// hovers, selects the item it lands on — and both of those are about what a FRAME
// did with a player's samples. The engine is what delivers them, so the engine's
// path is what the menu points drive.

/**
 * The region the build reports for item `index` of the menu the current screen
 * shows.
 *
 * Fails the running check when the build answers `null`, because a scenario that
 * has to drive an item has nothing to say when the build will not say where the
 * item is. `navigation/menu-item-rect-reported` is the point that grades the read
 * itself, including the two answers that are legitimately `null`.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  if (rect === null || rect === undefined) {
    fail(
      `menuItemRect(${index}) to report a region for item ${index} of the ` +
        `menu the ${h.snapshot().screen} screen shows ` +
        "(specs/instrumentation.md)",
      rect === undefined
        ? "the surface carries no menuItemRect at all"
        : "null, so the build reports no region for it",
    );
  }
  return rect;
}

/** The middle of that region: where a check aims its pointer or its finger. */
export function menuPoint(h: Harness, index: number): Point {
  return rectCenter(menuRect(h, index));
}

/**
 * Press a key, run the one frame that delivers it, and release it.
 *
 * The frame between the down and the up is what makes this a press the game can
 * see: the two conformant ways to read an action — latching the edge as it
 * arrives, and comparing held state at the top of each frame — agree only if the
 * key is genuinely held while a frame runs, and a down and an up delivered back
 * to back would be invisible to the second.
 */
export async function pressKey(h: Harness, code: string): Promise<void> {
  h.hold(code);
  await h.advance(1);
  h.release(code);
}

/**
 * Put a key down and leave it down, as a player holding it would.
 *
 * The pair to {@link releaseKey}, and the two ends {@link pressKey} joins with
 * one frame between them. What a check needs them apart for is
 * `specs/controls.md`'s "Holding a key moves the selection one step rather than
 * repeating it": the only way to read that is to run several frames with the key
 * genuinely down and see whether the selection moved again.
 */
export function holdKey(h: Harness, code: string): void {
  h.hold(code);
}

/** Release a key {@link holdKey} left down. */
export function releaseKey(h: Harness, code: string): void {
  h.release(code);
}

/**
 * Press several keys so that all of their edges land on ONE frame, then run it.
 *
 * What the two ordering rules at the end of specs/controls.md's keyboard section
 * are about: "When several edges arrive on one frame, `menu-up` is applied before
 * `menu-down`, and movement before `menu-confirm`."
 */
export async function pressKeysInOneFrame(
  h: Harness,
  codes: readonly string[],
): Promise<void> {
  for (const code of codes) h.hold(code);
  await h.advance(1);
  for (const code of codes) h.release(code);
}

/** Move the pointer onto item `index`, and run the frame that reads it. */
export async function hoverItem(h: Harness, index: number): Promise<void> {
  const at = menuPoint(h, index);
  h.pointer("pointermove", at.x, at.y);
  await h.advance(1);
}

/**
 * Press and release inside item `index`, and run the frame that delivers both.
 *
 * Both edges land in one region, which is the gesture specs/controls.md says
 * activates that item. No move precedes the press, so a build that only ever
 * selects on a move cannot pass this by hovering first.
 */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = menuPoint(h, index);
  h.pointer("pointerdown", at.x, at.y);
  h.pointer("pointerup", at.x, at.y);
  await h.advance(1);
}

/**
 * Press inside item `from`, carry the pointer into item `to`, and release it
 * there.
 *
 * The two edges land in different regions, which specs/controls.md says activates
 * nothing.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = menuPoint(h, from);
  const end = menuPoint(h, to);
  h.pointer("pointerdown", start.x, start.y);
  h.pointer("pointermove", end.x, end.y);
  h.pointer("pointerup", end.x, end.y);
  await h.advance(1);
}

/**
 * Land a contact inside item `index` and leave it down, with no move before it.
 *
 * The finger's shape, as far as this engine exposes one: the engine resolves a
 * touch contact into the same press, move and release a mouse raises, so what a
 * check can drive here is the LANDING with nothing before it — which is the half
 * of the rule specs/controls.md gives the finger that the mouse does not share.
 */
export async function landOnItem(h: Harness, index: number): Promise<void> {
  const at = menuPoint(h, index);
  h.pointer("pointerdown", at.x, at.y);
  await h.advance(1);
}

/** Land a contact inside item `index` and lift it there. */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const at = menuPoint(h, index);
  h.pointer("pointerdown", at.x, at.y);
  await h.advance(1);
  h.pointer("pointerup", at.x, at.y);
  await h.advance(1);
}

/** Land a contact inside item `from`, travel it onto item `to`, and lift it. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = menuPoint(h, from);
  h.pointer("pointerdown", start.x, start.y);
  await h.advance(1);
  const end = menuPoint(h, to);
  h.pointer("pointermove", end.x, end.y);
  await h.advance(1);
  h.pointer("pointerup", end.x, end.y);
  await h.advance(1);
}
