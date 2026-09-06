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
// the driver that threads a PURE surface through the engine's `apply`, the frame
// sweep, the cue stamping, the pixel and text readings, and the evidence a review
// item's output is written from — every engine-backed case needs exactly that,
// and it lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Cascade's: the shape
// of its snapshot, the table its checks are posed on, the tick rates its suites
// step at, the sentence a missing surface is failed against, and the readings its
// own geometry answers.
//
// The seam is one call. `createEngineCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object — including the ENGINE, which the
// package names none of — and hands back the machinery under Cascade's names and
// Cascade's types, so the suites next door go on importing `createHarness`,
// `captureStill` and `drawFrame` from `../harness` exactly as they did.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's frame counter, the cues the engine broadcast, and, for
// the rendering checks, the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the table through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `addCard` appends one
// card to a pile's top with a fresh id, `clearTable` empties all thirteen piles,
// `move` applies the game's own rules and reports what they decided, and `reset`
// gives everything back. Posing through it is how a scenario is reproducible, and
// it is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the engine
// holds the second element and returns it from `engine.debug`. The package's
// `readDebugSurface` does that read and stands an `absentSurface` in when there is
// nothing to read, so a build that returned no surface fails the checks that reach
// the game through it and never the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a simple
// engine's state model forces, WITH A THIRD CLASS OF OPERATION THE PACKAGE DOES
// NOT CARRY. The engine holds the state by value and hands it out read-only, so
// the surface is pure: a pose takes the current state and returns the next, a
// reading takes the current state and returns what it read — and `move` and
// `autoMove` do BOTH, returning the pair `[nextState, verdict]` (`surface.ts`). A
// check still writes `h.debug.setScreen("playing")` and `h.debug.move(...)`,
// because `h.debug` is {@link driveSurface}'s driver: the package's `applyDriver`
// for the poses and the readings, wrapped so a verdict pair is split INSIDE the
// transition. See {@link driveSurface} on why the pair cannot reach `apply` whole.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 240 Hz tick and every duration this case fixes is a
// whole number of them. That is why `[instrumentation]` carries no `tick_hz`:
// Cascade mandates no fixed timestep, every rate is per second and integrated
// against the delta the frame hands the game, and the SUITE is what fixes a step so
// a tolerance can be stated in frames and mean the same thing on every machine. A
// check that is specifically about the step size builds its own harness with a
// clock of its own, which is what `createHarness({ clock })` is for.
//
// THE PAINTED LAYER NEEDS A DRAWING SURFACE. specs/victory.md has the cascade paint
// onto a persistent layer of the build's own, which a browser build makes with
// `OffscreenCanvas` or a detached canvas element. This process has neither, and
// the package supplies neither, so `canvas-shim.ts` stands both up over
// `@napi-rs/canvas`, and it is imported first below so it is in place before any
// module of the build's is evaluated.

import "./canvas-shim";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Clock,
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
  type TimedCue,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  sampleColor as sampleClusterColor,
} from "./case-harness/engine/2d";
import { colorDistance, rgbOf, type Rgb } from "./case-harness/color";
import {
  drawnText as rawDrawnText,
  drawnTextLines,
  drawnTextRuns,
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
import type { Point } from "./case-harness/point";
import {
  BACKGROUND,
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  RANK_MAX,
  RANK_MIN,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  SUITS,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
  type Rect,
} from "./constants";
import { game as build, type CascadeState } from "../src/game";
import { fail } from "./assert";
import {
  READINGS,
  VERDICTS,
  type CardSnapshot,
  type CascadeDebugApi,
  type CascadeSnapshot,
  type DragSnapshot,
  type DropTargetSnapshot,
  type FlyerSnapshot,
  type MenuRect,
  type PileKind,
  type Screen,
  type SourcePile,
  type Suit,
} from "./surface";

// The logical runs a frame spells, for the suites that join a frame's text
// themselves. Copy is READ OFF THE RUNS, never off the `fillText` split: a
// build that letter-spaces a heading draws one glyph per call, and the
// specification fixes the words while leaving their spacing to the build. A
// suite that asks whether a frame spelled some copy imports the package's
// `drewText` from `../case-harness/text` directly; this project keeps no reader
// of its own for that question.
export { drawnTextLines } from "./case-harness/text";

export type {
  CardSnapshot,
  CascadeSnapshot,
  DragSnapshot,
  DropTargetSnapshot,
  FlyerSnapshot,
  MenuRect,
  PileKind,
  Screen,
  SourcePile,
  Suit,
};

/**
 * The clock the engine takes each frame's delta from.
 *
 * Re-exported so a check that is about the step size itself builds its second
 * harness out of one import rather than two.
 */
export { ConstantClock };
export type { Clock };

/** The case's surface, bound to the state type the build declared. */
export type CascadeSurface = CascadeDebugApi<CascadeState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<CascadeState, CascadeSurface>` here and the engine is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<CascadeState, CascadeSurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A reading `(state) => CascadeSnapshot` becomes `() => CascadeSnapshot` and a
 * reading `(state, index) => MenuRect | null` becomes `(index) => MenuRect |
 * null`: the driver hands each `engine.state` and passes the rest of the call
 * through. A verdict-returning operation
 * `(state, ...args) => [S, V]` becomes `(...args) => V`: the driver splits the pair
 * inside the transition, stores the state half and hands back the verdict. A pose
 * `(state, ...args) => S` becomes `(...args) => void`: the driver runs it through
 * `engine.apply`, so the state it returns is the state the next frame receives.
 * Anything else (`version`) is carried as it is.
 *
 * The first branch names the reading by its return type rather than by shape,
 * because a pose returns the build's own state and the compiler would otherwise
 * have to decide which of two structurally similar returns it was looking at.
 * {@link READINGS} states the same fact for the runtime driver.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>) => CascadeSnapshot
  ? () => CascadeSnapshot
  : M extends (state: DeepReadonly<S>, ...args: infer A) => MenuRect | null
    ? (...args: A) => MenuRect | null
    : M extends (state: DeepReadonly<S>, ...args: infer A) => [S, infer V]
      ? (...args: A) => V
      : M extends (state: DeepReadonly<S>, ...args: infer A) => S
        ? (...args: A) => void
        : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type CascadeDriver = Driver<CascadeState, CascadeSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so a
 * tolerance can be stated in frames and mean the same thing on every machine.
 *
 * 240 Hz divides every duration this case is timed against exactly: the launch
 * interval (`0.18` s) is `43.2` frames, the double-click window (`0.30` s) is `72`,
 * and the half-second the flight items integrate over is `120`. It is also the step
 * the cascade group's timing items are written against, so a figure quantized to a
 * frame boundary still meets the tolerances those items state.
 */
export const TICK_HZ = 240;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of game time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it; a check
 * that needs the exact elapsed time asserts against `seconds(framesFor(d))` rather
 * than against `d`.
 */
export function framesFor(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/**
 * The frame a RUN-OUT is stepped in.
 *
 * Three checks have to sit through the whole victory cascade before they can read
 * anything: `cascade/cascade-completes`, `screens/won-shows-message` and
 * `cascade/trail-survives-completion`. Twelve and a half seconds of game time at
 * {@link TICK_HZ} is three thousand frames, and every one of them renders up to
 * fifty-two card faces into a real canvas — so the wait, and not the reading, is
 * what those checks cost, and what they cost is what a busy host turns into a
 * timeout against a build that did nothing wrong.
 *
 * NONE OF THE THREE READS AN ACCELERATED QUANTITY. They read the cascade's own end
 * flag, the launched count, the flight being empty, the text the frame after it
 * drew, and how much of the table is still painted — facts about where the cascade
 * ENDED, none of them quantised to a frame. `TICK_HZ`'s own note says the fine step
 * is for the checks whose tolerances are stated in frames, and these state none;
 * `specs/instrumentation.md` has the game integrate whatever delta a frame supplies,
 * and `instrumentation/advances-in-frames` is the point that grades exactly that. So
 * a run-out stepped at sixty reaches the same end as one stepped at two hundred and
 * forty and costs a quarter as much, which was measured on the references: at 240,
 * 120, 60 and 30 Hz alike the cascade ends `cascadeDone` with all fifty-two launched
 * and nothing in flight, at the same `12.57` s of game time.
 *
 * Sixty is also what a browser gives a game on an ordinary display, so it is the
 * rate the ending a player sees really runs at.
 */
export const RUNOUT_HZ = 60;

/** Whole frames of the run-out clock covering at least `duration` seconds. */
export function runoutFrames(duration: number): number {
  return Math.ceil(duration * RUNOUT_HZ);
}

/** A harness whose clock steps the frames a run-out is waited out in. */
export function createRunoutHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock(1000 / RUNOUT_HZ) });
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
 * comes from is this engine's business — beside the state, as a pair — and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** The operations that both pose and report, as a set the driver tests against. */
const VERDICT_OPS = new Set<string>(VERDICTS);

/**
 * The imperative reading of Cascade's PURE surface, over the engine that holds
 * the state.
 *
 * TWO CLASSES OF OPERATION ARE THE PACKAGE'S AND THE THIRD IS THIS CASE'S.
 * `applyDriver` carries the two every simple-engine case has — a reading is
 * handed `engine.state` and its remaining arguments and answers directly, a pose
 * is run through `engine.apply` so the state it returns is the state the next
 * frame receives — and this wraps it for the third: `move` and `autoMove` POSE
 * AND REPORT, returning the pair `[nextState, verdict]` (`surface.ts`,
 * {@link VERDICTS}).
 *
 * THE PAIR CANNOT REACH `apply` WHOLE. The engine stores whatever the transition
 * returns, so a stored tuple would BE the state from that frame on and corrupt
 * every frame after it. So the pair is split inside the transition: the state
 * half is what the engine stores and the verdict half is what the call hands
 * back. A build that returned a state alone has posed the board and reported
 * nothing, and the verdict is `undefined` — which is exactly what
 * `instrumentation/move-accepts-legal` is there to read.
 *
 * LAZY, like the two it wraps: a member is read off the raw surface at the moment
 * a check reaches for it, so a build with no surface, or one missing an
 * operation, fails the CHECK that needed it rather than the `beforeEach` that
 * built the harness. A member that is not a function comes back as it is, which
 * is what lets `instrumentation/surface-present` test for each operation by
 * `typeof`.
 */
function driveSurface(engine: CascadeEngine, raw: object): CascadeDriver {
  const posed = applyDriver<
    DeepReadonly<CascadeState>,
    CascadeState,
    CascadeDriver
  >(engine, raw, { readings: READINGS });
  return new Proxy({} as CascadeDriver, {
    get: (_target, property): unknown => {
      if (typeof property !== "string" || !VERDICT_OPS.has(property)) {
        return Reflect.get(posed, property);
      }
      const member = (raw as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<CascadeState>,
        ...args: unknown[]
      ) => unknown;
      return (...args: unknown[]): unknown => {
        let verdict: unknown;
        engine.apply((state) => {
          const returned = op.call(raw, state, ...args);
          if (Array.isArray(returned)) {
            verdict = returned[1];
            return returned[0] as CascadeState;
          }
          verdict = undefined;
          return returned as CascadeState;
        });
        return verdict;
      };
    },
  });
}

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
 * The list is what a rendering check reads, and a rendering check reads ONE
 * frame: the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading,
 * which is what {@link drawFrame} does. But the list is recorded whether a check
 * reads it or not, and this case's longest sweeps run a whole cascade of
 * fifty-two cards over hundreds of frames at eleven hundred calls a frame, so an
 * uncapped list would be hundreds of megabytes in a check that never looks at it.
 * Past the cap the oldest half is dropped, which is far beyond any single frame
 * and so cannot cost a reading anything.
 *
 * The package's recorder keeps everything and is right to: the bound is a fact
 * about THIS case's longest sweep rather than about recording, which is why the
 * harnesses that carried one disagreed about the figure and most carried none.
 * `boundDrawLog` is where a case states its own.
 */
const MAX_RECORDED_CALLS = 200_000;

/** The engine this project stands a build up on. */
export type CascadeEngine = Engine<CascadeState, CascadeSurface>;

/** The engine's own state, which a check reads and nothing here can write. */
interface StateModel {
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<CascadeState>;
}

/**
 * The package's engine machinery, bound to Cascade on this engine.
 *
 * Everything the four engines disagree about is answered here from what THIS
 * engine is:
 *
 *  - `driver` is the apply-threaded strategy plus Cascade's verdict pair, see
 *    {@link driveSurface}.
 *  - `toLogical` is left at the identity. There is no camera under this engine —
 *    the engine maps the stage onto the canvas and nothing else stands between.
 *  - `pointerPrecision` stays `"exact"`, so a raised pointer lands exactly where
 *    the caller asked rather than on the nearest device pixel; every menu gesture
 *    below aims at the middle of a region the BUILD reported, and rounding that
 *    aim would be this harness moving the shot.
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
  StateModel
>({
  slug: "cascade",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // Every text call carries the width the canvas measured for it and the
  // alignment in force, which is what {@link drawnTextSpans} turns into the run's
  // span. Cascade reads WHERE a label landed — `screens/hud-shows-mode-label` and
  // `presentation/hud-labels-drawn` hold a drawn run against a region — and an
  // anchor alone cannot answer that.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<CascadeState, CascadeSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own table color, handed to the engine exactly as the seeded
      // `src/main.ts` hands it (specs/overview.md). Cascade registers no actions
      // and selects no touch layout, because every control is the pointer
      // (specs/controls.md), so neither is passed here either.
      background: BACKGROUND,
      clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (engine, raw) => driveSurface(engine, raw),
  snapshot: (debug) => debug.snapshot(),
  extend: (_base, engine) => ({
    get state() {
      return engine.state;
    },
  }),
});

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<
  CascadeSnapshot,
  CascadeDriver,
  CascadeEngine
> &
  StateModel;

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/* The vocabulary this project's suites read a frame's render in, straight off
   the package: one recorded operation, and a point on the stage. */
export type { DrawCall, Point };

/** One cue the build played, stamped with the frame it sounded on. */
export type { TimedCue };
export type PlayedCue = TimedCue;

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the engine's own message rather than with a teardown error on top of
 * it.
 *
 * The one thing this adds to the package's own factory is the bound on the draw
 * log — see {@link MAX_RECORDED_CALLS} — which has to be put on the harness that
 * was just built rather than named in the config above, because the log is the
 * recorder's array and the bound is Cascade's.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const h = await kit.createHarness(options);
  boundDrawLog(h.calls, MAX_RECORDED_CALLS);
  return h;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares its OUTPUTS beside its verdict: a `replay`, the frames
// the build itself drew while a check drove it, kept as evidence a reviewer can
// scrub against the reference implementation's, or an `image`, one frame of it.
// Both writers are the package's, bound here to this case's slug and to THIS
// directory, and both are evidence and never a verdict: the scenario's own value
// comes straight back, a scenario that throws still leaves what it recorded, a
// capture that closed no frames writes nothing, and outside a run the media
// directory is unset and the whole thing is a no-op that still runs the scenario.
//
// ARM A REPLAY NARROWLY. The victory cascade blits a full-screen painted layer
// every frame, and the recorder captures a source whose content can change at
// every use; it holds a bounded budget of captured image bytes before a new
// capture degrades to an opaque marker, so a recording armed around a whole
// cascade with the trail painting on buys a reviewer nothing and can cost the
// frames the check was about. Every `replay` in the `cascade` group therefore
// runs with `setTrailPainting(false)`, and the three in `winning` cover the win
// and the cascade's first frames alone.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "bounce", () =>
 *   h.until((s) => s.flyers[0].vy < 0, { maxFrames: 240 }),
 * );
 * assertTrue(swept.hit);
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
/* Naming a card                                                              */
/* -------------------------------------------------------------------------- */
//
// A scenario in this game is a table of cards, and writing one out as objects buries
// what it is under punctuation. So a card is written as its rank and its suit, the
// way a deck is read: `"KS"` is the King of spades, `"10H"` the ten of hearts, and a
// leading `"#"` marks it face-down. Nothing about the notation reaches the build;
// {@link parseCard} turns one into the three scalars `addCard` takes, and
// {@link cardSpec} turns a reported card back into one for a failure message.

/** The thirteen rank labels, Ace low, indexed by `rank - 1`. */
export const RANK_LABELS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

/** The letter each suit is written with. */
export const SUIT_LETTERS: Record<Suit, string> = {
  spades: "S",
  hearts: "H",
  diamonds: "D",
  clubs: "C",
};

/** The suit each letter names. */
const SUIT_OF_LETTER: Record<string, Suit> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

/** The color specs/deal.md gives a suit. */
export function colorOf(suit: Suit): "red" | "black" {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** One card as {@link parseCard} reads it: the three scalars `addCard` takes. */
export interface CardSpec {
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

/**
 * The card a spec names.
 *
 * A misspelt spec is a fault in the check rather than in the build, so it throws a
 * plain error rather than failing by assertion: a validator that asked for the
 * `"KX"` of nothing has not decided anything about the game.
 */
export function parseCard(spec: string): CardSpec {
  const faceUp = !spec.startsWith("#");
  const body = faceUp ? spec : spec.slice(1);
  const suit = SUIT_OF_LETTER[body.slice(-1).toUpperCase()];
  const rank = RANK_LABELS.indexOf(
    body.slice(0, -1).toUpperCase() as (typeof RANK_LABELS)[number],
  );
  if (suit === undefined || rank < 0) {
    throw new Error(
      `cascade: "${spec}" is not a card; write a rank of ` +
        `${RANK_LABELS.join("/")} and a suit of S/H/D/C, with a leading # ` +
        `for face-down`,
    );
  }
  return { suit, rank: rank + 1, faceUp };
}

/** A reported card written back as a spec, for a comparison or a failure message. */
export function cardSpec(card: CardSnapshot): string {
  const face = card.faceUp ? "" : "#";
  return `${face}${RANK_LABELS[card.rank - 1] ?? card.rank}${SUIT_LETTERS[card.suit] ?? card.suit}`;
}

/** A whole pile written back as specs, bottom card first. */
export function pileSpecs(cards: readonly CardSnapshot[]): string[] {
  return cards.map(cardSpec);
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in the
// check that makes them. What is here is the handful a check would otherwise write
// out every time: reaching a pile by the two scalars every operation names it with,
// its top card, and finding an entity by the id a pose handed back.
//
// A LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id because a
// pose put an entity on the table and the snapshot reported it; an id that is no
// longer there is the build having lost the entity, which is a verdict and not an
// absent value for the check to reason about. So these fail by assertion, naming
// what the surface promised, and the check reads the entity on the next line.

/** The cards on the named pile, bottom card first, as the snapshot reports them. */
export function pileOf(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): CardSnapshot[] {
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

/** The named pile's top card, or `null` where it holds none. */
export function topOf(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): CardSnapshot | null {
  const cards = pileOf(snapshot, pile, index);
  return cards.length === 0 ? null : cards[cards.length - 1];
}

/** Every card on the thirteen piles, in no particular order. */
export function tableCards(snapshot: CascadeSnapshot): CardSnapshot[] {
  return [
    ...snapshot.stock,
    ...snapshot.waste,
    ...snapshot.foundations.flat(),
    ...snapshot.tableau.flat(),
  ];
}

/** Where a card sits on the table: its pile, that pile's index, and its row. */
export interface CardPlace {
  pile: PileKind;
  index: number;
  /** The card's index within its pile, counted from the bottom. */
  row: number;
  card: CardSnapshot;
}

/** Where the card with that id sits, or `null` when no pile holds it. */
export function placeOf(
  snapshot: CascadeSnapshot,
  id: number,
): CardPlace | null {
  const piles: readonly { pile: PileKind; index: number }[] = [
    { pile: "stock", index: 0 },
    { pile: "waste", index: 0 },
    ...snapshot.foundations.map((_, index) => ({
      pile: "foundation" as const,
      index,
    })),
    ...snapshot.tableau.map((_, index) => ({
      pile: "tableau" as const,
      index,
    })),
  ];
  for (const at of piles) {
    const cards = pileOf(snapshot, at.pile, at.index);
    const row = cards.findIndex((card) => card.id === id);
    if (row >= 0) return { ...at, row, card: cards[row] };
  }
  return null;
}

/** The card with that id. Fails the check when the table no longer holds it. */
export function cardOf(snapshot: CascadeSnapshot, id: number): CardSnapshot {
  const found = placeOf(snapshot, id);
  if (found === null) {
    fail(
      `snapshot() to report the card with id ${id}: a card keeps its id for as ` +
        "long as it is on the table (specs/instrumentation.md)",
      tableCards(snapshot).map((card) => card.id),
    );
  }
  return found.card;
}

/** The flyer with that id. Fails the check when it is no longer in flight. */
export function flyerOf(snapshot: CascadeSnapshot, id: number): FlyerSnapshot {
  const found = snapshot.flyers.find((flyer) => flyer.id === id);
  if (found === undefined) {
    fail(
      `snapshot() to report the flyer with id ${id}: a flyer added through the ` +
        "surface keeps its id until it retires (specs/instrumentation.md)",
      snapshot.flyers.map((flyer) => flyer.id),
    );
  }
  return found;
}

/** The last flyer in the list, which is the one an `addFlyer` appended. */
export function lastFlyer(snapshot: CascadeSnapshot): FlyerSnapshot {
  const found = snapshot.flyers[snapshot.flyers.length - 1];
  if (found === undefined) {
    fail(
      "snapshot() to report the flyer addFlyer appended to the flight " +
        "(specs/instrumentation.md)",
      snapshot.flyers,
    );
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* The geometry of the table                                                  */
/* -------------------------------------------------------------------------- */
//
// Every figure here comes from this project's own `constants.ts`, which
// transcribes specs/table.md, so what these compute is the geometry the
// specification fixes rather than the geometry a build wrote down for itself.
//
// WHAT THEY ARE FOR IS AIMING, NOT GRADING. A check that has to press a card, or
// release a run over a column, needs the point that card is drawn at; that is what
// these give it. A check whose REQUIREMENT is the geometry itself, the `table`
// group's fourteen items, states its own figure and reads where the build actually
// drew, through {@link drawnBoxes}. Asserting a build's drawing against
// {@link columnCardTopLeft} would be asserting this file.

/** Whether a point lies inside a rectangle, its top and left edges included. */
export function pointIn(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** A card-sized rectangle at a top-left. */
export function cardRect(x: number, y: number): Rect {
  return { x, y, w: CARD_W, h: CARD_H };
}

/** The center of a card drawn at a top-left, which a release resolves against. */
export function cardCenter(x: number, y: number): Point {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** The anchor of one of the thirteen piles: the top-left its cards square to. */
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

/** The faces of a pile's cards, top of the pile last, as the offsets read them. */
export function facesOf(cards: readonly CardSnapshot[]): boolean[] {
  return cards.map((card) => card.faceUp);
}

/**
 * The gap drawn under each face-up card of a column holding cards with these faces,
 * by the compression rule specs/table.md fixes.
 *
 * The natural `FACE_UP_OFFSET` while the column fits above `COLUMN_BOTTOM_LIMIT`,
 * and otherwise the largest uniform value that does fit, never below
 * `FACE_UP_OFFSET_MIN`. The face-down gap stays at `FACE_DOWN_OFFSET` however far a
 * column is compressed, and the fit is made afresh from the cards a column holds, so
 * a column that lost cards draws the full offset again.
 */
export function faceUpGap(faces: readonly boolean[]): number {
  const gaps = faces.length - 1;
  if (gaps <= 0) return FACE_UP_OFFSET;

  let faceUp = 0;
  let faceDown = 0;
  for (let i = 0; i < gaps; i += 1) {
    if (faces[i]) faceUp += 1;
    else faceDown += 1;
  }
  if (faceUp === 0) return FACE_UP_OFFSET;

  const natural =
    TABLEAU_Y + faceDown * FACE_DOWN_OFFSET + faceUp * FACE_UP_OFFSET + CARD_H;
  if (natural <= COLUMN_BOTTOM_LIMIT) return FACE_UP_OFFSET;

  const fits =
    (COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y - faceDown * FACE_DOWN_OFFSET) /
    faceUp;
  return Math.max(FACE_UP_OFFSET_MIN, Math.min(FACE_UP_OFFSET, fits));
}

/** The top edge of every card in a column, from its first card down. */
export function columnCardTops(faces: readonly boolean[]): number[] {
  const gap = faceUpGap(faces);
  const tops: number[] = [];
  let y = TABLEAU_Y;
  for (const faceUp of faces) {
    tops.push(y);
    y += faceUp ? gap : FACE_DOWN_OFFSET;
  }
  return tops;
}

/** The top-left of the card at `row` of a column whose cards have these faces. */
export function columnCardTopLeft(
  col: number,
  row: number,
  faces: readonly boolean[],
): Point {
  const tops = columnCardTops(faces);
  return { x: COLUMN_X[col], y: tops[row] ?? TABLEAU_Y };
}

/** The bottom edge of a column's lowest drawn card, or of its empty slot. */
export function columnBottom(faces: readonly boolean[]): number {
  const tops = columnCardTops(faces);
  const last = tops.length === 0 ? TABLEAU_Y : tops[tops.length - 1];
  return last + CARD_H;
}

/**
 * The rectangle a pile answers a release in (specs/table.md).
 *
 * Every pile but a column holding cards answers a single card footprint at its
 * anchor; a column holding cards answers the whole extent it draws. The thirteen
 * rectangles do not overlap, so a point lies in at most one of them.
 */
export function dropRect(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): Rect {
  const anchor = pileTopLeft(pile, index);
  if (pile !== "tableau") return cardRect(anchor.x, anchor.y);
  const faces = facesOf(pileOf(snapshot, pile, index));
  if (faces.length === 0) return cardRect(anchor.x, anchor.y);
  return {
    x: anchor.x,
    y: TABLEAU_Y,
    w: CARD_W,
    h: columnBottom(faces) - TABLEAU_Y,
  };
}

/** The top-left the card at `row` of the named pile is drawn at. */
export function cardTopLeft(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
  row: number,
): Point {
  if (pile !== "tableau") return pileTopLeft(pile, index);
  return columnCardTopLeft(index, row, facesOf(pileOf(snapshot, pile, index)));
}

/** The point to press to grab the card at `row` of the named pile. */
export function pressPoint(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
  row: number,
): Point {
  const at = cardTopLeft(snapshot, pile, index, row);
  return cardCenter(at.x, at.y);
}

/**
 * The point to release a held run over so its leading card's center lands inside the
 * named pile's drop rectangle: that rectangle's own center.
 *
 * A held run is carried by the pointer's own displacement (specs/controls.md), so
 * the leading card's center sits at the pointer plus whatever separated the two when
 * the run was lifted. {@link pressPoint} presses a card at its center, which makes
 * that separation zero, so a gesture that grabs with {@link pressPoint} and releases
 * at {@link releasePoint} lands the leading card's center exactly on the target's,
 * well inside its rectangle. {@link drag} is the pairing of the two.
 *
 * A check whose requirement is the resolution rule itself states its own point
 * instead, derived from the rectangle specs/table.md fixes.
 */
export function releasePoint(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): Point {
  const rect = dropRect(snapshot, pile, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY AND ARRANGEMENT: which cards are on which
// pile, which card is left off the foundations, where a gesture presses and
// releases. Every threshold a check asserts is stated in the check itself, derived
// from the figure specs/ fixes for it, because a helper that carried the tolerance
// would hide what the check is really asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs. Nothing
// a check does not ask for happens.

/**
 * Open an EMPTY table in live play, with every gate at its default.
 *
 * This is the ground almost every check in this suite stands on. An empty table is
 * an isolated world on its own: Cascade has no autonomous entity, nothing arrives
 * uninvited, and the game moves only when a check moves it. So a check poses exactly
 * the cards its requirement concerns and nothing else.
 *
 * THE FOUR GATES ARE LEFT ON. `autoFlip`, `winDetect`, `launching` and
 * `trailPainting` are on after `reset`, which is what a player gets. A check turns
 * one off only when that gate is its own requirement, or when its requirement would
 * otherwise be entangled with the faculty the gate holds still: a single-flyer check
 * turns `launching` off so it reads one parabola instead of fifty-two, and every
 * `replay` in the `cascade` group turns `trailPainting` off so the recorder's budget
 * goes on the flight rather than on a full-screen blit per frame.
 *
 * `clearTable` follows `reset` rather than leaning on it, so the emptiness this
 * promises holds even for a build whose `reset` is wrong. `reset` is graded by its
 * own items.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 */
export function openTable(h: Harness): void {
  h.debug.reset();
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
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.clearTable();
}

/** The how-to screen, over an empty table. */
export function openHowto(h: Harness): void {
  h.debug.reset();
  h.debug.setScreen("howto");
  h.debug.clearTable();
}

/** The `won` screen, over an empty table, with nothing in flight. */
export function openWon(h: Harness): void {
  h.debug.reset();
  h.debug.setScreen("won");
  h.debug.clearTable();
}

/**
 * Pose `specs` onto the named pile, bottom card first, and report their ids.
 *
 * Each card is one `addCard`, which appends, so the LAST spec given ends up the
 * pile's top card. The ids come back in the order the specs were given.
 */
export function posePile(
  h: Harness,
  pile: PileKind,
  index: number,
  specs: readonly string[],
): number[] {
  const before = pileOf(h.snapshot(), pile, index).length;
  for (const spec of specs) {
    const card = parseCard(spec);
    h.debug.addCard(pile, index, card.suit, card.rank, card.faceUp);
  }
  return pileOf(h.snapshot(), pile, index)
    .slice(before)
    .map((card) => card.id);
}

/**
 * Pose one tableau column, bottom card first, and report the ids in that order.
 *
 * ```ts
 * poseColumn(h, 0, ["#5D", "#8C", "KS", "QH"]); // two buried, a King and a Queen
 * ```
 */
export function poseColumn(
  h: Harness,
  col: number,
  specs: readonly string[],
): number[] {
  return posePile(h, "tableau", col, specs);
}

/**
 * Build foundation `index` up from the Ace of `suit` to `upTo`, and report the ids.
 *
 * Every card is face-up, which is what a card on a foundation is. `upTo` is a rank,
 * so `poseFoundation(h, 0, "spades", 13)` completes a foundation.
 */
export function poseFoundation(
  h: Harness,
  index: number,
  suit: Suit,
  upTo: number,
): number[] {
  const letter = SUIT_LETTERS[suit];
  const specs: string[] = [];
  for (let rank = RANK_MIN; rank <= upTo; rank += 1) {
    specs.push(`${RANK_LABELS[rank - 1]}${letter}`);
  }
  return posePile(h, "foundation", index, specs);
}

/**
 * Pose the waste and the set memory it shows, and report the card ids.
 *
 * `specs` are the cards, bottom first, so the last is the waste's top. `sets` are
 * the turned sets, oldest first, and they are never omitted: a waste holding cards
 * with no sets shows none of them (specs/stock.md), so a pose that left the sets out
 * would arrange a table no check meant to ask for.
 *
 * ```ts
 * poseWaste(h, ["2C", "9H", "4S", "7D", "JC"], [3, 2]); // five cards, two showing
 * ```
 *
 * A `sets` that names more cards than `specs` gives is a fault in the check rather
 * than in the build, so it throws a plain error.
 */
export function poseWaste(
  h: Harness,
  specs: readonly string[],
  sets: readonly number[],
): number[] {
  const held = sets.reduce((sum, count) => sum + count, 0);
  if (held > specs.length) {
    throw new Error(
      `cascade: poseWaste was given ${specs.length} cards and sets holding ` +
        `${held}; a set memory never names more cards than the waste holds`,
    );
  }
  const ids = posePile(h, "waste", 0, specs);
  for (const count of sets) h.debug.addWasteSet(count);
  return ids;
}

/**
 * Pose the stock, bottom card first, and report the ids in that order.
 *
 * A turn takes from the stock's top, so the LAST spec given is the first card the
 * next `turnStock` moves onto the waste.
 */
export function poseStock(h: Harness, specs: readonly string[]): number[] {
  return posePile(h, "stock", 0, specs);
}

/** Where {@link poseNearlyWon} puts the one card still to be played. */
export interface NearlyWonOptions {
  /** The card left off the foundations. Defaults to the King of spades. */
  missing?: string;
  /** The pile it waits on. Defaults to `"tableau"`. */
  pile?: SourcePile;
  /** That pile's index. Defaults to `0`. */
  index?: number;
}

/** What {@link poseNearlyWon} left for the check to play. */
export interface NearlyWon {
  /** The id of the one card still to be played. */
  id: number;
  /** The card, as it was posed. */
  card: CardSpec;
  /** The foundation index its suit was built on. */
  foundation: number;
  /** The pile it is waiting on, and its row there. */
  from: { pile: SourcePile; index: number; row: number };
}

/**
 * Pose a table one card short of a win: fifty-one cards home, and the fifty-second
 * waiting where the caller asked for it.
 *
 * Each suit is built Ace to King on the foundation at its own index in `SUITS`, so
 * spades are foundation `0` and clubs foundation `3`, and the named card is left off
 * its suit's foundation and posed face-up on the waiting pile instead. A card waiting
 * on the waste is given a set of one, so the waste shows it.
 *
 * It changes no gate, so `winDetect` is on and the move that sends the last card
 * home wins the game, which is what {@link startCascade} then does. A check that
 * wants fifty-one home and no more reads the table as this leaves it.
 */
export function poseNearlyWon(
  h: Harness,
  options: NearlyWonOptions = {},
): NearlyWon {
  const card = parseCard(options.missing ?? "KS");
  const pile = options.pile ?? "tableau";
  const index = options.index ?? 0;
  const foundation = SUITS.indexOf(card.suit);

  for (const [at, suit] of SUITS.entries()) {
    const letter = SUIT_LETTERS[suit];
    const specs: string[] = [];
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      if (suit === card.suit && rank === card.rank) continue;
      specs.push(`${RANK_LABELS[rank - 1]}${letter}`);
    }
    posePile(h, "foundation", at, specs);
  }

  const spec = `${RANK_LABELS[card.rank - 1]}${SUIT_LETTERS[card.suit]}`;
  const ids =
    pile === "waste"
      ? poseWaste(h, [spec], [1])
      : posePile(h, pile, index, [spec]);
  const row = pileOf(h.snapshot(), pile, index).length - 1;
  return { id: ids[0], card, foundation, from: { pile, index, row } };
}

/**
 * Open a table one card short of a win and send that card home, so the cascade is
 * entered through the game's own win path.
 *
 * The move runs the build's own rules, so a build that refuses the last Ace of its
 * own suit onto its own foundation fails here rather than silently posing a cascade
 * it never earned. `screen` is `"won"` and the cascade is running when this returns,
 * with no frame yet advanced.
 */
export function startCascade(
  h: Harness,
  options: NearlyWonOptions = {},
): NearlyWon {
  openTable(h);
  const pending = poseNearlyWon(h, options);
  const accepted = h.debug.move(
    pending.from.pile,
    pending.from.index,
    pending.from.row,
    "foundation",
    pending.foundation,
  );
  if (accepted !== true) {
    fail(
      "move() to accept the last card of a suit onto that suit's foundation, " +
        "which is what wins the game (specs/foundations.md)",
      accepted,
    );
  }
  return pending;
}

/* ---- Gestures ------------------------------------------------------------- */
//
// The three pointer operations are immediate poses: each resolves the moment it is
// called, through the same input path a player's pointer feeds
// (specs/instrumentation.md), so a whole gesture is driven without advancing a
// frame. The helpers below compose them; `sweepPointer` is the one that goes through
// the ENGINE's pointer instead, for the check whose subject is what one frame does
// with the samples it was handed.

/**
 * Press at `from`, glide to `to` over `steps` moves, and release there.
 *
 * A DROP rather than a click, provided the two points are farther apart than
 * `DRAG_THRESHOLD` (specs/controls.md); a check that wants a click uses
 * {@link clickAt}, and the check whose requirement is the threshold states both
 * distances itself.
 *
 * Grab with {@link pressPoint} and release at {@link releasePoint} and the run's
 * leading card lands centered on the target.
 *
 * It poses, so it sounds nothing: a cue belongs to the frame its event happened on
 * and a pose runs between frames ({@link watchCues}). A check about the cue a
 * gesture sounds drives {@link sweepPointer} instead.
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
 * Press and release at one point, which is a CLICK: the release lies within
 * `DRAG_THRESHOLD` of its press, so it returns any held run, activates whatever
 * control the press landed in, and counts toward the double-click rule
 * (specs/controls.md).
 */
export function clickAt(h: Harness, x: number, y: number): void {
  h.debug.pointerDown(x, y);
  h.debug.pointerUp(x, y);
}

/**
 * Two clicks at one point with no frame between them, so the second press falls `0`
 * seconds of game time after the first and well inside `DOUBLE_CLICK_WINDOW`.
 *
 * A check about the window or the slop drives its own two clicks instead, advancing
 * between them or moving the second, so the figure it asserts is stated in the
 * check.
 */
export function doubleClickAt(h: Harness, x: number, y: number): void {
  clickAt(h, x, y);
  clickAt(h, x, y);
}

/**
 * Press and release at one point through the ENGINE's own pointer, and run the one
 * frame that delivers both.
 *
 * The real path's answer to {@link clickAt}. A control activated this way is
 * activated by a frame's own update, which is what a check about the CUE the control
 * sounds needs; see {@link watchCues}.
 */
export async function tapPointer(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointerdown", x, y);
  h.pointer("pointerup", x, y);
  await h.advance(1);
}

/**
 * Drive a whole gesture through the ENGINE's own pointer and then run the one frame
 * that delivers it.
 *
 * Every sample is dispatched before the frame runs, so the frame's update is handed
 * the press, the moves and the release together, in arrival order. That is what
 * separates a build answering every sample from one that keeps only the frame's last
 * sample (specs/controls.md): the second sees the release alone and has nothing in
 * hand.
 */
export async function sweepPointer(
  h: Harness,
  from: Point,
  to: Point,
  steps = 4,
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

/* ========================================================================== */
/* What the build drew, and what it played                                    */
/* ========================================================================== */
//
// The presentation, table, screens and audio halves of this suite need three things
// the scenario helpers do not provide: what one frame's render put where, a color
// sampler over the rendered canvas, and a cue record stamped with the frame each cue
// fired on. THE PALETTE IS THE BUILD'S: specs/overview.md fixes no color and no
// typeface, only what a player must be able to tell apart, so nothing here knows a
// color and the samplers compare what was painted against what else was painted.

/**
 * Run exactly one frame and hand back the calls THAT frame made.
 *
 * The reading every rendering check opens with. {@link Harness.calls} accumulates
 * across frames, so what a check about the picture wants is the frame it just drove
 * and not the setup before it.
 */
export async function drawFrame(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return [...h.calls];
}

/**
 * Toggle the engine's diagnostics overlay and hand back the frame that draws — or
 * stops drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key (`Backquote`)
 * toggles it through a keydown listener the engine itself owns on the harness's
 * event target (engine docs, `diagnostics.md`), and Cascade binds no key of its
 * own (specs/controls.md), so nothing the build wrote answers this. What the
 * BUILD owns is which diagnostic sources it registers, and the engine draws each
 * of them after the game's `render`, through the same context this harness
 * records — so with the panel up, the registered values land among the returned
 * calls as ordinary text draws, readable with {@link drawnText}.
 *
 * What comes back is that one frame's calls alone, exactly as {@link drawFrame}
 * hands them over, so a frame with the panel up is compared against a frame
 * without it rather than against everything drawn before either.
 */
export async function toggleOverlay(h: Harness): Promise<DrawCall[]> {
  h.hold("Backquote");
  h.release("Backquote");
  return drawFrame(h);
}

/* ---- Where a frame put its shapes ----------------------------------------- */

/** One axis-aligned box a frame drew, placed in logical units. */
export interface DrawnBox {
  /** The context method that drew it. */
  method: string;
  /** The box's TOP-LEFT, in logical units, which is how a card is placed. */
  x: number;
  y: number;
  /** The box's size, in logical units, always positive. */
  w: number;
  h: number;
}

/** A source's own pixel size, where it reports one. */
function naturalSize(
  source: unknown,
): { width: number; height: number } | null {
  const held = source as { width?: unknown; height?: unknown };
  if (typeof held?.width !== "number" || typeof held?.height !== "number") {
    return null;
  }
  return { width: held.width, height: held.height };
}

/** The rectangle a call names, in the coordinates the call itself was made in. */
function boxOf(call: DrawCall): [number, number, number, number] | null {
  if (call.kind !== "call") return null;
  const { method, args } = call;
  if (method === "drawImage") {
    const rest = args.slice(1);
    if (rest.length >= 8)
      return rest.slice(4, 8) as [number, number, number, number];
    if (rest.length >= 4)
      return rest.slice(0, 4) as [number, number, number, number];
    if (rest.length >= 2) {
      const size = naturalSize(args[0]);
      if (size === null) return null;
      return [rest[0] as number, rest[1] as number, size.width, size.height];
    }
    return null;
  }
  if (
    method === "fillRect" ||
    method === "strokeRect" ||
    method === "rect" ||
    method === "roundRect"
  ) {
    return args.slice(0, 4) as [number, number, number, number];
  }
  return null;
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * WHERE THE TRANSFORM COMES FROM, AND WHY IT IS WALKED RATHER THAN READ. The
 * package's recorder records the transform beside a TEXT call, because that is
 * the one reading whose extent depends on the font as well as on the geometry;
 * for every other call it records the arguments the build passed and nothing
 * else. So a reading that places a SHAPE carries the transform itself, exactly as
 * the package's own `textDraws` does for an unmeasured call: `save` pushes,
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

/**
 * Every rectangle `calls` drew, with its box mapped into logical units.
 *
 * A card is a `CARD_W x CARD_H` footprint placed by its corner (specs/table.md), and
 * a build is free to draw one by translating to that corner and drawing the
 * footprint about the origin, so a call's own arguments say nothing about where the
 * card landed. Each box's corners are taken through the transform in force at the
 * call and then back through the engine's fit, and what comes out is the
 * axis-aligned box on the stage that a check can hold against a pile's anchor.
 *
 * Every way a build can put a card-sized shape on the canvas is read: `fillRect`,
 * `strokeRect`, `rect` and `roundRect` under a fill or a stroke, and `drawImage` in
 * all three of its argument forms.
 */
export function drawnBoxes(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnBox[] {
  const view = h.viewport();
  const drawn: DrawnBox[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    const box = boxOf(call);
    if (box === null || !box.every((value) => typeof value === "number")) {
      return;
    }

    const [bx, by, bw, bh] = box;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [cx, cy] of [
      [bx, by],
      [bx + bw, by],
      [bx, by + bh],
      [bx + bw, by + bh],
    ]) {
      const at = apply(m, cx, cy);
      xs.push((at.x - view.offsetX) / view.scale);
      ys.push((at.y - view.offsetY) / view.scale);
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    drawn.push({
      method: call.method,
      x: left,
      y: top,
      w: Math.max(...xs) - left,
      h: Math.max(...ys) - top,
    });
  });
  return drawn;
}

/**
 * How far a drawn box's size may sit from the card footprint and still be read as a
 * card, in logical units.
 *
 * A card's footprint is fixed at `CARD_W x CARD_H` (specs/table.md), so this is not
 * a size tolerance: it is room for the one unit a build may lose insetting a stroke
 * or rounding a corner, and a shape that is not a card misses by tens of units.
 */
export const CARD_BOX_TOLERANCE = 2;

/** Every card-sized box among `boxes`, whichever call drew it. */
export function cardBoxes(
  boxes: readonly DrawnBox[],
  tolerance = CARD_BOX_TOLERANCE,
): DrawnBox[] {
  return boxes.filter(
    (box) =>
      Math.abs(box.w - CARD_W) <= tolerance &&
      Math.abs(box.h - CARD_H) <= tolerance,
  );
}

/** The first box in `boxes` whose top-left sits within `tolerance` of a point. */
export function boxAt(
  boxes: readonly DrawnBox[],
  x: number,
  y: number,
  tolerance = CARD_BOX_TOLERANCE,
): DrawnBox | null {
  return (
    boxes.find(
      (box) =>
        Math.abs(box.x - x) <= tolerance && Math.abs(box.y - y) <= tolerance,
    ) ?? null
  );
}
/* ---- Text ----------------------------------------------------------------- */

/**
 * Every string the frame drew, through `fillText` or `strokeText`.
 *
 * The package's reading, under this project's name for it: the RAW strings, one
 * per call, in the order `fillText` then `strokeText`.
 */
export const drawnText = rawDrawnText;

/**
 * Whether the frame drew `token` as a whole word, ignoring case.
 *
 * What the how-to copy's four standalone tokens are matched with: `ACE` inside
 * `PLACE` is not the word the specification asked for, and a substring match would
 * take it.
 *
 * Read off the logical runs the frame spells, as the package's `drewText` does:
 * `S T O C K` drawn a glyph per call is the word, and a match against the
 * `fillText` split would find five one-letter runs and no word among them.
 */
export function drewToken(calls: readonly DrawCall[], token: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`,
    "i",
  );
  return drawnTextLines(calls).some((line) => pattern.test(line));
}

/**
 * One run of text a frame drew, and the logical box its glyphs span.
 *
 * The package's `TextDraw`, under this project's name for it. It carries the
 * alignment in force at the draw as well, which no check here reads.
 */
export type TextSpan = TextDraw;

/**
 * Every run of text `calls` drew, placed in logical units.
 *
 * A build may anchor its text through any `translate`/`scale` it likes and align it
 * any way it likes, so the anchor is mapped through the transform the context held
 * at the call and the run is extended about it by its measured width and
 * `textAlign`; the extent is then carried back through the engine's fit into the
 * stage's own units. Which way a `start`/`end` alignment reads is the page's
 * direction; this game draws no right-to-left text, so they are left and right.
 *
 * ONE ENTRY PER CALL, never merged: the reading for a check that counts draws
 * or holds one draw's own extent. A check that reads COPY against a region asks
 * {@link drawnRunSpans} instead, whose runs are wider than any of their members.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(calls));
}

/**
 * The frame's text coalesced into the LOGICAL RUNS it spells, placed in logical
 * units the way {@link drawnTextSpans} places one call.
 *
 * What a reader that holds COPY against a REGION reads. A build that
 * letter-spaces a label draws one glyph per `fillText`, which is the only
 * portable way to letter-space canvas text, and specs/screens.md fixes the words
 * a control carries while leaving their spacing to the build; a span per call
 * would then carry one letter each and match no label. The shared harness's
 * merge rule (`case-harness/text.ts`) folds side-by-side draws on one baseline
 * back into the run they spell, and a run keeps its first draw's anchor while
 * its right edge grows, so its extent is the whole label's. Every raw string is
 * a substring of its run, so coalescing can only add a match.
 *
 * The runs come back in canvas pixels, placed exactly as {@link drawnTextSpans}
 * places one draw, and are carried back through the engine's fit the same way.
 */
export function drawnRunSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), drawnTextRuns(calls));
}

/* ---- Color ---------------------------------------------------------------- */
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no color and no typeface,
// only what a player must be able to tell apart, so nothing here knows a color and
// every reading below compares what was painted against what else was painted.

/** A sampled color, each channel 0 to 255. */
export type { Rgb };

/** Euclidean distance between two colors, `0` to about `441`. */
export { colorDistance };

/** The rendered color of the single device pixel under a logical point. */
export function pixelColor(h: Harness, x: number, y: number): Rgb {
  return rgbOf(h.pixel(x, y));
}

/**
 * The rendered color at a logical point, averaged over a small cluster.
 *
 * The center pixel plus four neighbors `radius` units out, so one stray
 * anti-aliased or shadowed pixel cannot swing the reading. The default keeps every
 * sample well inside a `100 x 140` card.
 */
export function sampleColor(h: Harness, x: number, y: number, radius = 4): Rgb {
  return sampleClusterColor(h, x, y, radius);
}

/**
 * `cols x rows` colors sampled evenly over a rectangle, row by row.
 *
 * How a check reads whether something was drawn ANYWHERE inside a region without
 * knowing what color the build drew it in: the painted trail under a flyer, a
 * highlight somewhere in a pile's rectangle. The samples are inset by half a cell,
 * so none of them lands on the rectangle's own edge, and each is ONE pixel rather
 * than a cluster, because a small painted mark averaged over its neighbourhood
 * washes out into the felt around it.
 */
export function sampleGrid(
  h: Harness,
  rect: Rect,
  cols: number,
  rows: number,
): Rgb[] {
  const samples: Rgb[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      samples.push(
        pixelColor(
          h,
          rect.x + (rect.w * (col + 0.5)) / cols,
          rect.y + (rect.h * (row + 0.5)) / rows,
        ),
      );
    }
  }
  return samples;
}

/**
 * The build's exported `BACKGROUND`, rasterized: the color the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same canvas
 * implementation the harness samples with, so a pixel the game never drew over
 * compares against it exactly.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterize(BACKGROUND);
  return { r, g, b };
}

/* ---- Cues ----------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so the
 * handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event, which is what tells a build that plays a cue on the right event apart from
 * one that plays it on every frame, or a frame late.
 *
 * A CUE IS RAISED BY A FRAME, NOT BY A POSE. Under this engine a pose is a pure
 * `(state, ...) => state` transform with no route to the audio bus, so a gesture
 * driven through the surface's pointer operations, or a `deal()` or `turnStock()`
 * pose, is free to sound nothing at all. A check whose requirement is a cue
 * therefore drives that cue's event through the REAL path and reads the list after
 * the frame that carried it: {@link tapPointer} and {@link sweepPointer} for the
 * gestures and the controls, and a plain `advance` for the cascade's own launches
 * and its win.
 *
 * The cue NAMES are `CUES` in this project's own `constants.ts`, transcribed
 * from the table in specs/audio.md, which also says which event each one
 * belongs to.
 */
export const watchCues = kit.watchCues;

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
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
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
