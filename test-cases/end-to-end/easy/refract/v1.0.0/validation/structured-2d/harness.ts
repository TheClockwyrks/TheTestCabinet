// Refract — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the canvas and
// its draw-command recorder, the debug surface and the stand-in for a missing
// one, the frame sweep, the cue stamping, the pixel and text readings, and the
// evidence a review item's output is written from — is the shared
// `@clockwyrks/case-harness` package's, staged in beside this file as
// `./case-harness/`. What stays HERE is what is genuinely Refract's: the case's
// types, the tick rate its suites step at, the projection its snapshot is read
// through, the sentence a missing surface is failed against, the patches its
// bench is sampled at, and every scenario helper that poses this game. The kit
// takes the case's types as GENERICS and everything else about it as one config
// object — including the engine itself, which arrives as values (`createEngine`,
// `ConstantClock`, the game definition), because the package names no engine.
//
// RECONCILING AFTER A POSE. A helper below that poses anything a reading derives
// from — a node's `x`/`y`, a crystal's `spent`, a beam's `complete`, `solved`,
// `targets` — reconciles before it returns, and before the frame that draws the
// pose, so a check posed through the helpers never calls `reconcile` itself. A
// check that poses with `h.debug.setScreen`/`loadBoard` directly calls it once
// before its first read. THE POINTER HELPERS DELIBERATELY DO NOT: a pointer
// operation is the player's own route, and a build that leaves a reading stale
// after one has left it stale for a player too, which is the defect rather than
// something the harness should hide.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state, its
// tagged actors — the events the engine broadcast (the cues), and — for the
// rendering checks — the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below
// only ARRANGE the game through the debug surface, and the real rules the
// build wrote are what decide every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `loadBoard`
// poses a board the rules apply to unchanged, the pointer operations feed the
// same input path a player's pointer feeds and are subject to every limit a
// hand-drawn trace is, and `reset` gives everything back. Posing through it is
// how a scenario is arranged, and it is the seam the case's specification
// documents. `surface.ts` is that specification as types, and it is the only
// description of the surface this harness reads: the build's own module for it
// is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check —
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. The package's `readDebugSurface`
// does that read and stands an `absentSurface` in when there is nothing to
// read, so the fault lands on the points whose checks reach the game through the
// surface rather than on the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN. Directly — the `identityDriver` strategy. Under
// this engine the raw surface IS imperative, so no wrapper stands between a
// check and the object the build returned. The three pointer operations take
// effect the moment they are called (specs/instrumentation.md), so a whole
// route is drawn with no frame advanced between the calls — the immediacy is
// itself a specified behavior, and the suite about it advances nothing. One
// consequence is worth stating once, here: a SCREEN-CHANGING pose (`reset`,
// `setScreen`, `loadBoard`) may land at the call or as late as the end of the
// next advanced frame — the spec fixes the arrangement, not the moment, and
// both designs are conformant — so a scenario poses, advances a frame, and
// then reads, which is correct under either design. The scenario helpers below
// carry those advances so a check does not have to.
//
// THE CLOCK. `ConstantClock(TICK_MS)` is the default, so one frame is one
// 120 Hz tick. Refract mandates no timestep of its own — every rate is per
// second and the pointer resolves at the call — so the fixed clock is the
// SUITE's choice, made so a duration is a whole number of frames on every
// machine. A check that is specifically about the step size
// (instrumentation/advances-on-elapsed-time) builds its own harnesses with
// clocks of its own.

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
  colorDistance,
  nearestTo,
  rgbOf,
  type Rgb,
} from "./case-harness/color";
import {
  createEngineCaseHarness,
  identityDriver,
  rasterize,
  type EngineHarness,
  type EngineHarnessOptions,
  type TimedCue,
} from "./case-harness/engine/index";
import {
  allInLogical,
  canvasPixels as readCanvasPixels,
  makeReplayCapture,
  pixelsChanged as countPixelsChanged,
  sampleColor as sampleClusterColor,
  type EngineFrameReader,
  type EnginePointReader,
} from "./case-harness/engine/2d";
import {
  drawnText as rawDrawnText,
  drawnTextLines as spelledLines,
  reanchoredTextRuns,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import type { DrawCall } from "./case-harness/draw-calls";
import type { Point } from "./case-harness/point";
import { BACKGROUND, game as build } from "../src/game";
import { assertEqual, assertTruthy, fail } from "./assert";
import { BINDINGS, LAYOUT } from "./constants";
import { MINIMAL_2X1 } from "./fixtures";
import {
  CHANNELS,
  MAX_TIER,
  STAGE_H,
  STAGE_W,
  cellCenter,
  parseBoard,
  tierForSolvedCount,
  type Board,
} from "./notation";
import { CAMPAIGN_BOARDS } from "./routes";
import type { Beams } from "./rules";
import type {
  CellRef,
  Channel,
  Mode,
  PointerDevice,
  RefractDebugApi,
  RefractSnapshot,
  TargetSnapshot,
} from "./surface";

export type {
  CellRef,
  Channel,
  Mode,
  PointerDevice,
  RefractSnapshot,
  TargetSnapshot,
};

/* The readings this project takes straight off the package, under its names. */
export type { DrawCall, Rgb };
export { colorDistance };

/** The case's surface, exactly as `surface.ts` specifies it. */
export type RefractSurface = RefractDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain
 * data — so no wrapper stands between a check and the object the build
 * returned, and the driver type is the surface type itself. The alias is kept
 * so a check reads the same way it does under an engine whose surface needs
 * driving.
 */
export type RefractDriver = RefractSurface;

/** The engine this project stands a build up on. */
export type RefractEngine = Engine<RefractSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameDefinition<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<RefractSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<RefractSurface>;

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: `src/constants.ts` deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames,
 * so a tolerance can be stated in ticks and mean the same thing on every
 * machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business: a build whose `initialize` REJECTED
 * never reaches it — the engine's own rejection fails the suite's `beforeEach`
 * with the engine's message, which is why every suite's `afterEach` disposes
 * with `?.` — and what is named here is the other fault, a return that is no
 * surface at all.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A snapshot with every beam cell narrowed to the two fields the specs fix.
 *
 * specs/state.md declares `interface Cell { col, row }` and
 * specs/instrumentation.md's Snapshot shape writes `cells: [{ col, row }]`, so
 * `col` and `row` are what a cell means. Neither says a cell may carry nothing
 * else, and specs/state.md's contract grants the build fields that "hold
 * derived data you can rebuild from the declared ones" — a cell that also names
 * its node's kind or channel is exactly that. So every check compares on the
 * two fields the specs fix, and no check grades the rest either way. A cell
 * missing `col` or `row` still fails: the projection reads those two properties
 * and yields `undefined`.
 *
 * The snapshot the surface returned is never touched. Every container the
 * projection rewrites is a fresh object, so a check holding an earlier snapshot
 * sees what it saw.
 */
function projectCells(snapshot: RefractSnapshot): RefractSnapshot {
  const projected: RefractSnapshot = { ...snapshot };

  const beams: unknown = snapshot.beams;
  if (typeof beams === "object" && beams !== null) {
    const narrowed: Record<string, unknown> = { ...beams };
    for (const [channel, beam] of Object.entries(narrowed)) {
      if (typeof beam !== "object" || beam === null) continue;
      const cells: unknown = (beam as { cells?: unknown }).cells;
      if (!Array.isArray(cells)) continue;
      narrowed[channel] = {
        ...beam,
        cells: (cells as CellRef[]).map((cell) => ({
          col: cell.col,
          row: cell.row,
        })),
      };
    }
    projected.beams = narrowed as RefractSnapshot["beams"];
  }

  const tracing = snapshot.tracing;
  if (typeof tracing === "object" && tracing !== null) {
    const live: unknown = tracing.live;
    if (typeof live === "object" && live !== null) {
      const cell = live as CellRef;
      projected.tracing = {
        ...tracing,
        live: { col: cell.col, row: cell.row },
      };
    }
  }

  return projected;
}

/**
 * The engine's object model, which this engine has and its simple sibling does
 * not: the open world, the live game state, and the instance that outlives every
 * level.
 *
 * Getters rather than fields, so each reads FRESH on every access. Refract runs
 * in one world for the whole session, but reading it through the engine keeps a
 * check honest against a build that rebuilt it anyway.
 */
interface WorldModel {
  readonly world: World;
  readonly state: GameState;
  readonly instance: GameInstance<RefractSurface>;
}

/** The directory this file sits in, which is the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The package's engine machinery, bound to Refract on this engine.
 *
 * Three of the config's members are where the four engines really differ, and
 * each is answered here from what THIS engine is:
 *
 *  - `driver` is the identity, because a structured engine's surface is already
 *    imperative.
 *  - `toLogical` goes through the world's camera. The camera opens at the
 *    defaults — world and logical coordinates coincide, which is the space every
 *    figure in `src/constants.ts` is stated in — so the projection is the
 *    identity unless the build moved it, and mapping through it keeps every
 *    pixel reading and every raised pointer honest either way.
 *  - `pointerPrecision` is `"device-pixel"`: a raised pointer lands on the same
 *    device pixel a reading would sample, which is what this project's checks
 *    have always been decided under.
 */
const kit = createEngineCaseHarness<
  RefractSnapshot,
  RefractDriver,
  RefractEngine,
  WorldModel
>({
  slug: "refract",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // The text readings below place a run about its anchor, so each text call is
  // measured and the transform in force at it recorded.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<RefractSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own bench background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (_engine, raw) => identityDriver(raw as RefractSurface),
  snapshot: (debug) => projectCells(debug.snapshot()),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "device-pixel",
  extend: (_base, engine, initialized) => ({
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance: initialized as GameInstance<RefractSurface>,
  }),
});

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<
  RefractSnapshot,
  RefractDriver,
  RefractEngine
> &
  WorldModel;

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** One cue the build played, stamped with the frame it sounded on. */
export type { TimedCue };
export type PlayedCue = TimedCue;

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the four-way layout — so one harness serves every build of this case.
 * Everything else the build decided lives inside `src/game.ts`.
 */
export const createHarness = kit.createHarness;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

/** Every recorded firing of the cue named `name`, oldest first. */
export const cuesNamed = kit.cuesNamed;

/** Forget every cue recorded so far, so a check reads its own section alone. */
export const clearCues = kit.clearCues;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Four properties are what make them usable, and all four are the package's:
// they record the SECTION rather than the run, they are evidence and never a
// verdict (a scenario that throws still leaves what it recorded, and the
// scenario's own value comes straight back), they write only what there is to
// look at, and they cost nothing when nobody is collecting.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await captureReplay(h, "extend", async () => {
 *   h.debug.pointerMove(x, y);
 *   await h.advance(12);
 * });
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("refract", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the posed board, the refused move's
 * unchanged beam, the select grid. What is written is whatever the last frame
 * that RAN left behind, so call it after the frame that poses the thing under
 * test and before the assertions, so a check that fails still leaves the picture
 * that shows why.
 */
export const captureStill = kit.captureStill;
/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or the real
// registered actions — and then lets the build's own rules run. They fix only
// arrangement: which board is posed, which route is traced. Every threshold a
// check asserts is stated in the check itself, derived from the figure or rule
// specs/ states for it.

/**
 * `reset()` and the frame that lands it: the title screen, everything at its
 * title-screen value. Every suite's opening move.
 */
export async function resetTo(h: Harness): Promise<void> {
  h.debug.reset();
  // `reset` rewrites the whole world, and every derived reading with it.
  h.debug.reconcile();
  await h.advance(1);
}

/**
 * A notation string's rows, tolerating the surrounding whitespace the fixture
 * template literals carry, exactly as `parseBoard` tolerates it — so the rows
 * handed to the build's `loadBoard` are the same ones the oracle parsed.
 */
export function notationRows(notation: string): string[] {
  return notation
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Pose `notation` through the build's `loadBoard`, advance the frame that
 * lands and renders it, and hand back the oracle's parse of the same notation —
 * the board every expected value is computed from.
 */
export async function loadBoard(h: Harness, notation: string): Promise<Board> {
  h.debug.loadBoard(notationRows(notation));
  // The board, the beams and the screen are what a reading derives from, so
  // the readings are brought into agreement before the frame that draws them.
  h.debug.reconcile();
  await h.advance(1);
  return parseBoard(notation);
}

/** The stage center of `cell` on the CURRENT snapshot board's grid. */
export function centerOf(h: Harness, cell: CellRef): { x: number; y: number } {
  const { cols, rows } = h.snapshot().board;
  return cellCenter(cell.col, cell.row, cols, rows);
}

/** `pointerDown` at a cell's center, resolved the moment it is called. */
export function pressCell(h: Harness, cell: CellRef): void {
  const { x, y } = centerOf(h, cell);
  h.debug.pointerDown(x, y);
}

/** `pointerMove` to a cell's center, resolved the moment it is called. */
export function moveToCell(h: Harness, cell: CellRef): void {
  const { x, y } = centerOf(h, cell);
  h.debug.pointerMove(x, y);
}

/**
 * Draw a whole route through the surface's three pointer operations: a press
 * at the first cell's center, a move to each remaining center, then a release,
 * each resolved against the live world the moment it is called.
 *
 * The sequence lives here rather than on the surface: a route is a compound of
 * atomic operations, and a compound belongs to whoever is driving
 * (specs/instrumentation.md carries the three operations and no sugar over
 * them). A list the limits refuse part way through leaves the beam ending at
 * the last segment they permitted, which is itself a specified behavior a
 * check can read back.
 */
export function traceCells(h: Harness, cells: readonly CellRef[]): void {
  if (cells.length === 0) return;
  pressCell(h, cells[0]);
  for (const cell of cells.slice(1)) moveToCell(h, cell);
  h.debug.pointerUp();
}

/** {@link traceCells} over a route stored as `[col, row]` pairs. */
export function traceRoute(
  h: Harness,
  route: ReadonlyArray<readonly [number, number]>,
): void {
  traceCells(h, toCells(route));
}

/* ---- The player's own pointer path ----------------------------------------- */
//
// The debug surface's pointer operations resolve "against the live state before
// the call returns rather than deferred to the next frame"
// (specs/instrumentation.md), which is exactly right for arranging a board and
// wrong for two kinds of check. A cue is fixed as played "on the frame its
// event happens", by the code that raised it (specs/ui.md), and an event
// resolved between frames has no frame to be played on. And specs/controls.md
// phrases extending and retracting about the pointer a PLAYER holds, so the
// held drag is the subject rather than a way to reach one.
//
// The helpers below raise the real sample through {@link Harness.pointer} and
// then run the ONE frame that delivers it, so the frame a cue must play on is
// the frame the helper advanced — and nothing about the game's own resolution
// is bypassed: the hit radius, the grab rules, and every limit run as they do
// for a player.

/**
 * Press at `cell`'s center as a player's pointer does, then run the one frame
 * that delivers the sample to the game.
 */
export async function playerPress(h: Harness, cell: CellRef): Promise<void> {
  const { x, y } = centerOf(h, cell);
  h.pointer("pointerdown", x, y);
  await h.advance(1);
}

/**
 * Move the held pointer to `cell`'s center as a player's pointer does, then
 * run the one frame that delivers the sample — the frame whatever the move
 * raises happens on.
 */
export async function playerMoveTo(h: Harness, cell: CellRef): Promise<void> {
  const { x, y } = centerOf(h, cell);
  h.pointer("pointermove", x, y);
  await h.advance(1);
}

/**
 * Move the held pointer to a logical stage POINT rather than to a cell center,
 * then run the one frame that delivers the sample. For a check that has to put
 * the pointer somewhere a cell center is not — just inside or just outside a
 * node's targeting radius.
 */
export async function playerMoveToPoint(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointermove", x, y);
  await h.advance(1);
}

/**
 * Release at `cell`'s center as a player's pointer does, then run the one frame
 * that delivers the sample.
 */
export async function playerRelease(h: Harness, cell: CellRef): Promise<void> {
  const { x, y } = centerOf(h, cell);
  h.pointer("pointerup", x, y);
  await h.advance(1);
}

/**
 * Draw `cells` end to end the way a player draws them: a press on the first, a
 * move to each of the rest, and a release on the last — every sample real,
 * every one delivered by its own frame.
 */
export async function playerDraw(
  h: Harness,
  cells: readonly CellRef[],
): Promise<void> {
  const [first, ...rest] = cells;
  if (first === undefined) return;
  await playerPress(h, first);
  for (const cell of rest) await playerMoveTo(h, cell);
  await playerRelease(h, cells[cells.length - 1]);
}

/**
 * Set `state.mode` alone, through the pose that sets its own field and nothing
 * else, then run the one frame that draws what the current screen draws.
 *
 * For a check that needs the game to BE in a mode without moving a screen or
 * choosing a board. Entering a mode from the title is the mode's own entry
 * point, which {@link startCampaign} and {@link startCascade} drive.
 */
export async function poseMode(h: Harness, mode: Mode): Promise<void> {
  h.debug.setMode(mode);
  h.debug.reconcile();
  await h.advance(1);
}

/** `[col, row]` pairs — the shape `routes.ts` stores — as a cell list. */
export function toCells(
  route: ReadonlyArray<readonly [number, number]>,
): CellRef[] {
  return route.map(([col, row]) => ({ col, row }));
}

/**
 * The action's first bound key, from the case-fixed `BINDINGS` table, pressed
 * and released as a player would press it — the REAL registered-action path,
 * which is the only way the menus move (specs/ui.md).
 */
export async function tapAction(
  h: Harness,
  action: keyof typeof BINDINGS,
): Promise<void> {
  await h.tap(BINDINGS[action][0]);
}

/**
 * Open the campaign's select grid on a fresh course, through the two
 * single-field poses that ARE what choosing CAMPAIGN does:
 * specs/modes/campaign.md fixes the effect as "sets `state.mode` to
 * `\"campaign\"` and goes to `select`", and nothing else.
 *
 * Through the poses rather than through the title menu, deliberately: a build
 * with a broken title menu and a correct grid must fail the menu checks and
 * pass the grid's, so campaign/campaign-starts is where taking the item is the
 * subject and every other check reaches the campaign directly.
 */
export async function startCampaign(h: Harness): Promise<void> {
  await resetTo(h);
  h.debug.setMode("campaign");
  h.debug.setScreen("select");
  // `targets` derives from the screen.
  h.debug.reconcile();
  await h.advance(1);
}

/**
 * From a fresh title, begin a cascade sequence by taking the title's CASCADE
 * item with the pointer. Lands on `playing` with the first generated board.
 */
export async function startCascade(h: Harness): Promise<void> {
  await resetTo(h);
  await enterCascade(h);
}

/**
 * Begin a cascade sequence from wherever the game stands, WITHOUT resetting:
 * the title screen is posed through its single-field operation, and the entry
 * is taken with the pointer.
 *
 * Starting Cascade is not a pose. specs/modes/cascade.md makes it set the
 * mode, zero `solvedCount`, set `tier` to 1, GENERATE the first board and move
 * to `playing`, and no operation on the surface does all of that — so the
 * sequence is begun the way the game itself begins it. The route is the
 * pointer rather than the menu keys: CASCADE is `TITLE_ITEMS[1]`, so
 * specs/controls.md fixes its target as `menu-1` and taking that target as
 * "the same as `confirm` with `state.menuIndex` at `i`", which reaches the
 * entry without walking the highlight — a build whose `down` does not move the
 * highlight owes that point to screens/title-down and to no cascade check. A
 * check that has progress it must not lose (a solved campaign course, say)
 * uses this rather than {@link startCascade}, whose fresh title costs a reset.
 */
export async function enterCascade(h: Harness): Promise<void> {
  h.debug.setScreen("title");
  // `targets` derives from the screen, and the title's target is read below.
  h.debug.reconcile();
  await h.advance(1);
  const cascade = targetCenter(targetById(h.snapshot(), "menu-1"));
  await pressRelease(h, cascade);
}

/* ---- The campaign course -------------------------------------------------- */

/**
 * Solve campaign board `index` (zero-based) by tracing the routes `routes.ts`
 * precomputed from specs/campaign-boards.md under the specs/beams.md rules —
 * derived from the specs, never copied from the reference. The board must be
 * open on `playing`. Traces are immediate, so the whole solve costs nothing.
 *
 * The routes were solved against the SPECIFIED board. A build that shipped a
 * different board fails here — its rules refuse a route the specified board
 * permits, or the solve never lands — which is the right verdict, and
 * campaign/boards-as-written names that fault directly.
 */
export function solveCampaignBoard(h: Harness, index: number): void {
  const data = CAMPAIGN_BOARDS[index];
  assertTruthy(data, `campaign board ${index + 1} exists in routes.ts`);
  for (const channel of CHANNELS) {
    const route = data.routes[channel];
    if (route === undefined) continue;
    traceCells(h, toCells(route));
  }
  assertEqual(
    h.snapshot().solved,
    true,
    `campaign board ${index + 1} solved by the spec-derived route`,
  );
}

/**
 * Enter the campaign and REALLY solve boards 1..n in order — campaign progress
 * has no pose (specs/instrumentation.md poses boards, never progress), so this
 * is how a suite reaches a later course state.
 *
 * Entry is board 1 via `confirm` on the fresh select grid (the highlight rests
 * on board 1 before any board has been entered), and each later board is
 * entered from the solved screen's first choice, "next board" (menuIndex 0 on
 * arrival). The snapshot taken ON ENTERING each board is returned, oldest
 * first, so a suite can hold every entered board against the authoritative
 * notation. After the call the game sits where the last solve left it: the
 * `solved` screen for n < 24, and `complete` for the solve that finishes the
 * course.
 */
export async function driveCourse(
  h: Harness,
  n: number,
): Promise<RefractSnapshot[]> {
  await startCampaign(h);
  await tapAction(h, "confirm"); // enter board 1 from the fresh select grid
  const entered: RefractSnapshot[] = [];
  for (let index = 0; index < n; index += 1) {
    const arrival = h.snapshot();
    assertEqual(
      arrival.screen,
      "playing",
      `entering campaign board ${index + 1}`,
    );
    assertEqual(arrival.boardIndex, index, `campaign board ${index + 1} is up`);
    entered.push(arrival);
    solveCampaignBoard(h, index);
    await h.advance(1);
    if (index < n - 1) {
      // The solved screen's first choice is "next board" (specs/modes/campaign.md).
      await tapAction(h, "confirm");
    }
  }
  return entered;
}

/* ---- The cascade sequence -------------------------------------------------- */

/** A snapshot's board as the oracle's `Board`, for the solver and the rules. */
export function boardFromSnapshot(snapshot: RefractSnapshot): Board {
  return {
    cols: snapshot.board.cols,
    rows: snapshot.board.rows,
    nodes: snapshot.board.nodes.map((node) => ({
      col: node.col,
      row: node.row,
      kind: node.kind,
      channel: node.channel,
      charges: node.charges,
    })),
  };
}

/**
 * Trace one full beam per channel of `beams`, in `CHANNELS` order. Every
 * prefix of a rule-satisfying beam set is itself rule-satisfying, so the
 * build's own limits accept each move of a solution found by the solver.
 */
export function traceBeams(h: Harness, beams: Beams): void {
  for (const channel of CHANNELS) {
    const cells = beams[channel];
    if (cells === undefined) continue;
    traceCells(h, cells);
  }
}

/**
 * Pose a cascade run in progress: the mode, the boards-solved count, and the
 * tier the ladder puts that count at, through the three single-field poses
 * specs/instrumentation.md carries for them.
 *
 * The tier is the spec's own formula over the count (`tierForSolvedCount`, from
 * specs/modes/cascade.md), so the posed run is one a player could have reached.
 * No board is chosen and none is generated: a caller poses one through
 * `loadBoard`, asks the generator for one through `generateBoard`, or takes
 * NEXT BOARD, whichever its requirement is about. The poses act on the live
 * state at the call and none of them changes the screen, so no frame is
 * advanced here.
 */
export function poseCascadeRun(h: Harness, solvedCount: number): void {
  h.debug.setMode("cascade");
  h.debug.setSolvedCount(solvedCount);
  h.debug.setTier(tierForSolvedCount(solvedCount));
  h.debug.reconcile();
}

/**
 * Pose the minimal board (`MINIMAL_2X1`, two adjacent emitters of one channel)
 * through `loadBoard` and solve it with its one segment, handing back the state
 * the solve left.
 *
 * On a cascade run this is one solve of the run: R9 holds on the move, the
 * count rises, the tier is recomputed, and the game moves to `solved`
 * (specs/modes/cascade.md, The sequence), exactly as it does for a generated
 * board, because "a board posed this way is a board like any other"
 * (specs/instrumentation.md). It is how a suite about the run's progression
 * solves a board without dragging the generator or the solver onto its point.
 */
export async function solvePosedBoard(h: Harness): Promise<RefractSnapshot> {
  await loadBoard(h, MINIMAL_2X1);
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  return h.snapshot();
}

/** One board the generator was asked for, as it arrived. */
export interface GeneratedBoard {
  /** The tier it was generated at, the argument `generateBoard` was given. */
  tier: number;
  /** Which board of that tier's rounds it is, counted from 1. */
  round: number;
  /** The snapshot on arrival, `playing` with every beam empty. */
  snapshot: RefractSnapshot;
  /** The board itself, in the oracle's shape. */
  board: Board;
}

/**
 * Ask the generator for `perTier` boards at every tier of the ladder, through
 * `generateBoard`, and hand each back as it arrived: tier 1's boards first,
 * then tier 2's, up to `MAX_TIER`.
 *
 * The run is posed into cascade first, so the boards arrive as a player would
 * meet them, and each one is rendered by the frame after its pose so a caller
 * can read pixels or capture a still. `onBoard` runs on each board while it is
 * in play, before the next is asked for, and may solve it: the next pose
 * replaces whatever the previous board was left as. Nothing here asserts
 * beyond the board's arrival; the record is handed back for the caller to hold
 * against its own point.
 */
export async function generateAtTiers(
  h: Harness,
  perTier: number,
  onBoard?: (generated: GeneratedBoard) => void | Promise<void>,
): Promise<GeneratedBoard[]> {
  h.debug.setMode("cascade");
  const generated: GeneratedBoard[] = [];
  for (let tier = 1; tier <= MAX_TIER; tier += 1) {
    for (let round = 1; round <= perTier; round += 1) {
      h.debug.generateBoard(tier);
      // A generated board is posed exactly as `loadBoard` poses one.
      h.debug.reconcile();
      await h.advance(1);
      const snapshot = h.snapshot();
      assertEqual(
        snapshot.screen,
        "playing",
        `generateBoard(${tier}) puts a board in play (specs/instrumentation.md)`,
      );
      const entry: GeneratedBoard = {
        tier,
        round,
        snapshot,
        board: boardFromSnapshot(snapshot),
      };
      generated.push(entry);
      await onBoard?.(entry);
    }
  }
  return generated;
}

/* ---- Reading the rendered pixels ------------------------------------------ */
//
// Every reading below is the package's, bound to this case's geometry. The pure
// halves — what a colour distance is, how a cluster is placed, which of several
// samples is nearest a reference — live in `./case-harness/color` and are shared
// with the engineless sibling project, so the two cannot drift on what a
// threshold means. What is stated here is only what is Refract's: which patches
// of bench are candidates, and what "the barest of them" means for this case.

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 px out — all well inside `NODE_R`
 * (30) of a sampled node's centre — so one stray anti-aliased or glow pixel
 * cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleClusterColor(h as EnginePointReader, x, y);
}

/**
 * Candidate patches of bare bench, in logical units, clear of everything this
 * specification places: outside the largest board's extent (x 352..928,
 * y 152..632, specs/board.md) by more than `NODE_R`, and off the stage's
 * vertical centre line where the heading above the board and the footer below
 * it sit. The mode's readouts sit clear of the board but their exact spot is
 * the build's, so no single patch is guaranteed bare — see
 * {@link sampleBackground}.
 */
export const BACKGROUND_POINTS: readonly Point[] = [
  { x: 170, y: 392 },
  { x: 1110, y: 392 },
  { x: 170, y: 600 },
  { x: 1110, y: 180 },
];

/**
 * The bare bench's colour: the sampled {@link BACKGROUND_POINTS} patch nearest
 * the rasterized clear colour, read off the canvas as it stands.
 *
 * Nearest-to-clear rather than darkest, because Refract fixes no palette
 * (specs/board.md): a build's bench may be light. Whatever a build draws over
 * a patch — a readout, a texture louder than quiet — moves that patch away
 * from the colour the engine cleared the frame to, so the patch nearest the
 * clear is the barest of the candidates.
 *
 * NOT THE SAME RULE AS THE SIMPLE-2D PROJECT'S, which takes the MEDOID of its
 * own four patches. Both answer "the barest of these", and they answer it
 * differently — this one against a colour known from outside the picture, that
 * one against the other samples alone — so the two are separate readings in the
 * package (`nearestTo` and `medoidOf`) and each project binds the one its
 * verdicts were taken under.
 */
export function sampleBackground(h: Harness): Rgb {
  const clear = clearColor();
  return nearestTo(
    BACKGROUND_POINTS.map((point) => sampleColor(h, point.x, point.y)),
    clear,
  );
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the
 * same canvas implementation the harness samples with, so a pixel the game
 * never drew over compares against it exactly.
 */
export function clearColor(): Rgb {
  return rgbOf([...rasterize(BACKGROUND), 255]);
}

/**
 * The canvas's whole backing store, copied — so a check can hold two frames
 * apart and say whether anything the build drew changed between them.
 */
export function canvasPixels(h: Harness): Uint8ClampedArray {
  return readCanvasPixels(h as EngineFrameReader);
}

/** How many bytes differ between two {@link canvasPixels} captures. */
export function pixelsChanged(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  return countPixelsChanged(before, after);
}

/* ---- Reading one frame's text draws ---------------------------------------- */
//
// Every reading here is the package's, which walks the frame's calls once and
// places each text draw through the transform the recorder took at it. What this
// file adds is the conversion out of canvas pixels and into the stage's logical
// units, which is where every figure a check states is stated. At the harness's
// default shape the two coincide; at any other they do not, and a check that
// runs at another shape reads what it meant either way. Copy is matched by the
// package's `drewText`, which a suite imports from `../case-harness/text`
// directly: it reads the logical runs the frame spells, so there is nothing to
// convert and nothing for this file to add.

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return rawDrawnText(calls);
}

/** Every logical run of text the frame spelled, as the strings it spells. */
export function drawnTextLines(calls: readonly DrawCall[]): string[] {
  return spelledLines(calls);
}

/** One run of text a frame drew, and the logical x range its glyphs span. */
export type TextSpan = TextDraw;

/**
 * Every run of text the frame drew, placed in logical units, ONE PER CALL.
 *
 * A build may anchor its text through any transform the pipeline or its own
 * drawing applies and align it any way it likes, so the anchor is mapped
 * through the transform the context held at the call and the run is extended
 * about it by its measured width and `textAlign`.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws
 * it through the same context this harness records, in device pixels under an
 * identity transform, which this mapping carries back to logical units like any
 * other run.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(h.calls));
}

/**
 * Every logical run of text the frame spelled, placed in logical units.
 *
 * The placed companion to {@link drawnTextLines}, and the reader a check uses
 * when it needs both the copy and where it sits — a board's number on the
 * select grid, a HUD label and the figure beside it.
 *
 * RE-ANCHORED about the whole run, under its first draw's alignment, so a
 * centred heading drawn a glyph at a time answers the centre of the heading
 * rather than the centre of its first glyph. A run of one draw comes back
 * exactly as {@link drawnTextSpans} reports it. The package also ships the other
 * reading — the run left at its first draw's anchor — and the two disagree only
 * on a merged run that is not `start`-aligned; see the package README's
 * collision table.
 */
export function drawnTextRuns(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), reanchoredTextRuns(h.calls));
}

/* ---- The diagnostics overlay ------------------------------------------------ */

/**
 * Toggle the engine's diagnostics overlay and run the frame that draws — or
 * stops drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key
 * (`Backquote`) toggles it through a keydown listener the engine itself owns
 * on the harness's event target, never through a registered action
 * (engine docs, diagnostics.md). It is drawn after the pipeline renders,
 * through the same context this harness records — so with the overlay up, the
 * registered sources' lines land in `h.calls` as ordinary text draws, readable
 * with {@link drawnText} — but AFTER the engine recorder's bracket closes, so
 * none of it appears in a `captureReplay` recording. Capture overlay evidence
 * with {@link captureStill}.
 *
 * No suite in this project presses the toggle at present. Under this engine,
 * registering the sources is the whole of the build's part, so
 * `instrumentation/overlay` reads the registry through `engine.diagnostics()`
 * rather than the drawn panel. It stays because the engineless sibling's
 * overlay check does press the key — there the panel is the build's own layer
 * and the only place the readings surface — and the three projects' harnesses
 * answer to one vocabulary.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* Pointer targets                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The target the current screen reports under `id`, or a failure naming what it
 * did report.
 *
 * specs/controls.md fixes the id set per screen, so a build that carries the
 * target but names it something else fails here on the id rather than silently
 * later on a press that lands nowhere.
 */
export function targetById(
  snapshot: RefractSnapshot,
  id: string,
): TargetSnapshot {
  const found = snapshot.targets?.find((target) => target.id === id);
  if (found === undefined) {
    return fail(
      `the ${snapshot.screen} screen reports a pointer target "${id}" ` +
        "(specs/controls.md, Pointer targets)",
      (snapshot.targets ?? []).map((target) => target.id),
    );
  }
  return found;
}

/** The middle of a target, which is where every pointer check aims. */
export function targetCenter(target: TargetSnapshot): Point {
  return { x: target.x + target.w / 2, y: target.y + target.h / 2 };
}

/** Whether two target rectangles share any area. */
export function targetsOverlap(a: TargetSnapshot, b: TargetSnapshot): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Press at a point, release at another, and settle a frame — the gesture every
 * target is taken by. Both points are in the stage's logical units, and the
 * release defaults to the press.
 */
export async function pressRelease(
  h: Harness,
  press: Point,
  release: Point = press,
  device: PointerDevice = "mouse",
): Promise<void> {
  h.debug.pointerDown(press.x, press.y, device);
  if (release.x !== press.x || release.y !== press.y) {
    h.debug.pointerMove(release.x, release.y, device);
  }
  h.debug.pointerUp(device);
  await h.advance(1);
}
