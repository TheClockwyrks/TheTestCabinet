// Refract — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the canvas and
// its draw-command recorder, the debug surface and the stand-in for a missing
// one, the driver that threads a PURE surface through the runtime's `apply`, the
// frame sweep, the cue stamping, the pixel and text readings, and the evidence a
// review item's output is written from — is the shared
// `@clockwyrks/case-harness` package's, staged in beside this file as
// `./case-harness/`. What stays HERE is what is genuinely Refract's: the case's
// types, the tick rate its suites step at, the projection its snapshot is read
// through, the sentence a missing surface is failed against, the patches its
// bench is sampled at, and every scenario helper that poses this game.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the events the runtime broadcast (`cue:played`), and — for the
// rendering checks — the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the world through the debug surface, and the real rules the build
// wrote are what decide every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `loadBoard`
// poses a board and moves to `playing`, the pointer operations feed the same
// immediate input path a player's pointer feeds, so a whole route is drawn
// without a frame passing, and `reset` gives everything back. Posing through it
// is how a scenario is reproducible, and it is the seam the case's specification
// documents. `surface.ts` is that specification as types, and it is the only
// description of the surface this harness reads: the build's own module for it
// is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`, and
// the runtime holds the second element and returns it from `engine.debug`.
// Reading it back off the runtime is the only way a surface reaches a check,
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. The package's `readDebugSurface`
// does that read and stands an `absentSurface` in when there is nothing to read,
// so the fault lands on the points whose checks reach the game through the
// surface rather than on the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a
// simple engine's state model forces. The runtime holds the state BY VALUE, so
// the surface the build returns is pure: a pose is `(state, ...args) => State`
// and a reading is `(state) => R`, and neither can be called by a check
// directly because neither has the state. The package's `applyDriver` supplies
// it — a reading is handed `engine.state`, a pose is run through `engine.apply`
// so the state it returns is the state the next frame receives — and the
// `READINGS` list in `surface.ts` is what tells the two apart, because nothing
// about a pure surface distinguishes them at run time.
//
// WHERE THE EXPECTED VALUES COME FROM. The spec-derived oracle beside this
// file: `notation.ts` (the board notation and the cell center formula),
// `rules.ts` (R1–R9 as specs/beams.md states them), `solver.ts` (a bounded
// deterministic solver over those rules), `fixtures.ts` (posable boards), and
// `routes.ts` (the twenty-four campaign boards with solver-produced routes).
// None of it reads the reference implementation; every figure traces to a
// statement in specs/.
//
// THE CLOCK. `ConstantClock(TICK_MS)` is the default, so one frame is one
// 120 Hz tick. Refract fixes no timestep — every pointer operation takes
// effect the moment it is called — so the clock matters only to the checks
// about `simTime` and the cues, and a check that is specifically about the
// step size builds its own harnesses with clocks of its own.

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
import { colorDistance, medoidOf, rgbOf, type Rgb } from "./case-harness/color";
import {
  DevicePointerEvent,
  applyDriver,
  createEngineCaseHarness,
  rasterize,
  type EngineHarness,
  type EngineHarnessOptions,
  type PureDriver,
  type TimedCue,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  sampleColor as sampleClusterColor,
  type EnginePointReader,
} from "./case-harness/engine/2d";
import {
  drawnText as rawDrawnText,
  drewText as spelledText,
  drawnTextLines as spelledLines,
  reanchoredTextRuns,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import type { DrawCall } from "./case-harness/draw-calls";
import type { Point } from "./case-harness/point";
import { BACKGROUND, game as build, type RefractState } from "../src/game";
import { assertEqual, fail } from "./assert";
import { BINDINGS, LAYOUT } from "./constants";
import {
  CHANNELS,
  NODE_R,
  STAGE_H,
  STAGE_W,
  cellX,
  cellY,
  parseBoard,
  type Board,
} from "./notation";
import { CAMPAIGN_BOARDS } from "./routes";
import type { Beams } from "./rules";
import { solve } from "./solver";
import {
  READINGS,
  type CellRef,
  type Mode,
  type PointerDevice,
  type RefractDebugApi,
  type RefractSnapshot,
  type TargetSnapshot,
} from "./surface";

export type { CellRef, Mode, PointerDevice, RefractSnapshot, TargetSnapshot };

/* The readings this project takes straight off the package, under its names. */
export type { DrawCall, Rgb };
export { colorDistance };

/** The case's surface, bound to the state type the build declared. */
export type RefractSurface = RefractDebugApi<RefractState>;

/**
 * The surface as every check drives it: every member of the pure surface, minus
 * its state argument, over the runtime that holds the state.
 */
export type RefractDriver = PureDriver<
  DeepReadonly<RefractState>,
  RefractState,
  RefractSurface
>;

/** The runtime this project stands a build up on. */
export type RefractEngine = Engine<RefractState, RefractSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own `RefractDebugApi` for the surface its
 * `initialize` returns, and that type is the build's: what a check holds it to
 * is `surface.ts`, so the game is cast to the case's
 * `Game<RefractState, RefractSurface>` here and the runtime is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<RefractState, RefractSurface>;

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: Refract deliberately fixes no
 * timestep, because the engine hands the game whatever elapsed time a frame
 * really took. Fixing it here makes a duration a whole number of frames, so a
 * tolerance can be stated in ticks and mean the same thing on every machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

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
 * projection rewrites is a fresh object, so a check holding an earlier
 * snapshot sees what it saw.
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

/** The runtime's own state, which a check reads and nothing here can write. */
interface StateModel {
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose
   * it through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<RefractState>;
}

/** The directory this file sits in, which is the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The package's engine machinery, bound to Refract on this engine.
 *
 * Four of the config's members are where the engines differ, and each is
 * answered here from what THIS engine is:
 *
 *  - `driver` is the apply-threaded strategy, over `surface.ts`'s `READINGS`.
 *    Its `project` is the ONE point a snapshot is narrowed on this engine, and
 *    so the one place a beam's cells are: `h.snapshot()` and both reads a sweep
 *    makes come through it.
 *  - `toLogical` is left at the identity. There is no camera under this engine —
 *    the runtime maps the stage onto the canvas and nothing else stands between.
 *  - `pointerPrecision` stays `"exact"`, so a raised pointer lands exactly where
 *    the caller asked rather than on the nearest device pixel.
 *  - `pointerEvent` is the DEVICE-bearing event, because specs/controls.md
 *    distinguishes a mouse from a touch and a pen, and the runtime's pointer
 *    input reads `pointerType`, `button` and `buttons` off the event to tell
 *    them apart.
 */
const kit = createEngineCaseHarness<
  RefractSnapshot,
  RefractDriver,
  RefractEngine,
  StateModel
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
    createEngine<RefractState, RefractSurface>({
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
    }),
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<RefractState>, RefractState, RefractDriver>(
      engine,
      raw,
      {
        readings: READINGS,
        project: (op, value) =>
          op === "snapshot" ? projectCells(value as RefractSnapshot) : value,
      },
    ),
  snapshot: (debug) => debug.snapshot(),
  pointerEvent: (type, x, y, device) =>
    new DevicePointerEvent(type, x, y, device ?? "mouse"),
  extend: (_base, engine) => ({
    get state() {
      return engine.state;
    },
  }),
});

/** Everything a check reads off one runtime running one build. */
export type Harness = EngineHarness<
  RefractSnapshot,
  RefractDriver,
  RefractEngine
> &
  StateModel;

/** The window a harness reports to the runtime, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** One cue the build played, stamped with the frame it sounded on. */
export type { TimedCue };
export type PlayedCue = TimedCue;

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

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The runtime publishes `cue:played` synchronously from inside `audio.play`,
 * so the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. Cues fire from `update`
 * on the frame their event happens (specs/ui.md), and the pointer poses are
 * applied between frames — so the pattern is: pose, watch, advance one frame,
 * and the cue for the posed event is on that frame.
 */
export const watchCues = kit.watchCues;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames
// the build itself drew while a check drove it, kept as evidence a reviewer
// can scrub. Both writers are the package's, bound here to this case's slug and
// to THIS directory — the project root may never be derived inside the package,
// which is staged one level deeper than this file, or every output would be
// addressed one directory too far down.
//
// Both are evidence, never a verdict: the scenario's own value comes straight
// back, a scenario that throws still leaves what it recorded, a capture that
// closed no frames writes nothing, and outside a run the media directory is
// unset and the whole thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement — the assertions stay exactly where they
 * were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("refract", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion. What is written is whatever the last
 * frame that RAN left behind, so call it after the frame that poses the thing
 * under test and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;
/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or drives the
// real menus through the registered actions — and then lets the real game
// decide everything from there. They fix only arrangement: which board is
// posed, which route is traced. Every threshold a check asserts is stated in
// the check itself, derived from the figure or rule specs/ states for it.

/**
 * `reset({seed})` through the surface, then one frame so the title is drawn.
 *
 * Every suite's opening move: the pose itself is immediate, and the frame is
 * what puts the title on the canvas for the checks that read pixels or draws.
 */
export async function resetTo(h: Harness, seed?: number): Promise<void> {
  h.debug.reset(seed === undefined ? undefined : { seed });
  await h.advance(1);
}

/**
 * Pose a board written in specs/board.md notation and render it.
 *
 * Accepts the same template-literal-friendly strings the fixtures are written
 * as: blank lines and per-line surrounding whitespace are dropped, and each
 * remaining line is one row. The surface's `loadBoard` takes the rows as the
 * notation defines them, one string per row, and the parsed board comes back so
 * a caller can measure against it.
 */
export async function loadBoard(h: Harness, notation: string): Promise<Board> {
  const rows = notation
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  h.debug.loadBoard(rows);
  await h.advance(1);
  return parseBoard(rows.join("\n"));
}

/** A route as `routes.ts` stores it: ordered `[col, row]` pairs. */
export type RoutePairs = ReadonlyArray<readonly [number, number]>;

/** `[col, row]` pairs as the cell list {@link traceCells} takes. */
export function toCells(route: RoutePairs): CellRef[] {
  return route.map(([col, row]) => ({ col, row }));
}

/**
 * Draw one route through the surface's three pointer operations: a press at the
 * first cell's center, a move to each remaining center, then a release. Each
 * pose is immediate — every pointer operation takes effect in the state the
 * call returns — so nothing advances here; a check that wants the drawn beam
 * rendered advances a frame itself.
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
  const { cols, rows } = h.snapshot().board;
  const first = nodeCenter(cells[0].col, cells[0].row, cols, rows);
  h.debug.pointerDown(first.x, first.y);
  for (const cell of cells.slice(1)) {
    const point = nodeCenter(cell.col, cell.row, cols, rows);
    h.debug.pointerMove(point.x, point.y);
  }
  h.debug.pointerUp();
}

/** {@link traceCells} over a route stored as `[col, row]` pairs. */
export function traceRoute(h: Harness, route: RoutePairs): void {
  traceCells(h, toCells(route));
}

/** The registered actions, as the build's own `BINDINGS` table names them. */
export type ActionName = keyof typeof BINDINGS;

/**
 * Fire one registered action through the engine's real input path: a tap of
 * the first key `BINDINGS` binds it to, then the one frame that delivers the
 * edge to the game's `update`.
 */
export async function tapAction(h: Harness, action: ActionName): Promise<void> {
  const code = BINDINGS[action][0];
  if (code === undefined) {
    return fail(`a key bound to the ${action} action in BINDINGS`, []);
  }
  await h.tap(code);
}

/**
 * Open the campaign's select grid, through the two single-field poses that ARE
 * what choosing CAMPAIGN does: specs/modes/campaign.md fixes the effect as
 * "sets `state.mode` to `\"campaign\"` and goes to `select`", and nothing
 * else. The one frame after them is what puts the grid on the canvas. Assumes
 * a fresh course (`resetTo` first), which is what the menu item would leave.
 *
 * Through the poses rather than through the title menu, deliberately: a build
 * with a broken title menu and a correct grid must fail the menu checks and
 * pass the grid's, so campaign/campaign-starts is where taking the item is the
 * subject and every other check reaches the campaign directly. The arrival is
 * asserted here because every course helper below stands on it: a build whose
 * debug surface cannot open the campaign fails with the requirement named
 * rather than three helpers later.
 */
export async function startCampaign(h: Harness): Promise<RefractSnapshot> {
  h.debug.setMode("campaign");
  h.debug.setScreen("select");
  await h.advance(1);
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "select",
    "the campaign opens on select (specs/modes/campaign.md)",
  );
  return snapshot;
}

/**
 * Begin a cascade sequence by taking the title's CASCADE item with the pointer.
 * Assumes a title on screen (`resetTo` first), and asserts the arrival for the
 * same reason {@link startCampaign} does.
 *
 * Cascade's entry is not a pose: specs/modes/cascade.md makes starting it set
 * the mode, zero `solvedCount`, set `tier` to 1, GENERATE the first board, and
 * move to `playing`, and the surface carries no operation that generates a
 * board. So the sequence is begun the way the game itself begins it. The route
 * is the pointer rather than the menu keys: CASCADE is `TITLE_ITEMS[1]`, so
 * specs/controls.md fixes its target as `menu-1` and taking that target as
 * "the same as `confirm` with `state.menuIndex` at `i`", which reaches the
 * entry without walking the highlight — a build whose `down` does not move the
 * highlight owes that point to screens/title-down and to no cascade check.
 */
export async function startCascade(h: Harness): Promise<RefractSnapshot> {
  const cascade = targetCenter(targetById(h.snapshot(), "menu-1"));
  await pressRelease(h, cascade);
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "playing",
    "taking CASCADE on the title goes straight to playing " +
      "(specs/modes/cascade.md)",
  );
  return snapshot;
}

/**
 * Begin a cascade sequence from wherever the game stands, WITHOUT resetting:
 * the title screen is posed through its single-field operation, and the entry
 * itself is taken the way {@link startCascade} takes it. A check that has
 * progress it must not lose (a solved campaign course, say) uses this rather
 * than {@link startCascade}, whose fresh title is only reached by a reset.
 */
export async function enterCascade(h: Harness): Promise<RefractSnapshot> {
  h.debug.setScreen("title");
  await h.advance(1);
  return startCascade(h);
}

/** The snapshot's board as the oracle's `Board`, for `rules.ts`/`solver.ts`. */
export function oracleBoard(snapshot: RefractSnapshot): Board {
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
 * Solve the course board at `index` (zero-based) by tracing the routes
 * `routes.ts` precomputed from specs/campaign-boards.md under the
 * specs/beams.md rules — derived from the specs, never from the reference.
 *
 * Assumes the board is in play with every beam empty. The channels are traced
 * in `CHANNELS` order; the final permitted move is what solves the board, so
 * the game itself is what leaves `playing` (specs/beams.md R9).
 */
export function solveCourseBoard(h: Harness, index: number): RefractSnapshot {
  const data = CAMPAIGN_BOARDS[index];
  if (data === undefined) {
    return fail(`a course board index 0..${CAMPAIGN_BOARDS.length - 1}`, index);
  }
  for (const channel of CHANNELS) {
    const route = data.routes[channel];
    if (route !== undefined) traceRoute(h, route);
  }
  const snapshot = h.snapshot();
  if (snapshot.screen !== "solved" && snapshot.screen !== "complete") {
    fail(
      `board ${data.board} solved by the routes derived from ` +
        "specs/campaign-boards.md under the specs/beams.md rules " +
        "(screen solved, or complete on the last board)",
      { screen: snapshot.screen, solved: snapshot.solved },
    );
  }
  return snapshot;
}

/**
 * Really solve course boards 1..`n`, entering each through the real menus.
 *
 * Assumes a fresh campaign at `select` ({@link startCampaign} after a
 * `resetTo`): the highlight sits on board 1, `confirm` enters it, and each
 * solve's `solved` screen opens with its first choice — next board —
 * highlighted, so one `confirm` walks on. Traces are immediate, so the whole
 * course costs milliseconds. Returns the snapshot after the `n`-th solve: on
 * `solved` (or `complete` when `n` is the whole course), with the finished
 * board still behind it.
 */
export async function driveCourse(
  h: Harness,
  n: number,
): Promise<RefractSnapshot> {
  let snapshot = h.snapshot();
  for (let index = 0; index < n; index += 1) {
    // From select the confirm enters the highlighted board; from a solved
    // screen it takes the first choice, next board (specs/modes/campaign.md).
    await tapAction(h, "confirm");
    snapshot = h.snapshot();
    assertEqual(
      snapshot.screen,
      "playing",
      `driveCourse: entering course board ${index + 1} goes to playing ` +
        "(specs/modes/campaign.md)",
    );
    snapshot = solveCourseBoard(h, index);
    await h.advance(1);
  }
  return snapshot;
}

/**
 * Really solve `k` generated cascade boards in sequence, proving each solvable
 * by solving it with the spec-derived solver.
 *
 * Assumes a cascade in play ({@link startCascade} after a `resetTo`). Each
 * round reads the board off the snapshot, runs `solver.ts` over it, traces the
 * beams it found, and takes NEXT BOARD — the solved screen's first choice —
 * to move on. Returns the snapshot after the `k`-th solve, on `solved`.
 *
 * Documented residual risk: the solver is capped (DEFAULT_MAX_EXPANSIONS), so
 * a conformant generator could in principle emit a board the cap abandons.
 * Every board within the tier ladder's stated shapes resolves in milliseconds
 * in practice — the worst campaign board needs about a thousand expansions —
 * so the cap is a runaway stop, and a `limit` result is reported as such
 * rather than as "unsolvable".
 */
export async function solveGenerated(
  h: Harness,
  k: number,
): Promise<RefractSnapshot> {
  let snapshot = h.snapshot();
  for (let round = 0; round < k; round += 1) {
    if (snapshot.screen === "solved") {
      await tapAction(h, "confirm"); // NEXT BOARD (specs/modes/cascade.md)
      snapshot = h.snapshot();
    }
    assertEqual(
      snapshot.screen,
      "playing",
      `solveGenerated: cascade board ${round + 1} in play ` +
        "(specs/modes/cascade.md)",
    );
    const board = oracleBoard(snapshot);
    const result = solve(board);
    if (result.status !== "solved") {
      fail(
        "a solvable generated board (specs/modes/cascade.md: every board " +
          "the generator emits is solvable; the spec-derived solver " +
          `reported '${result.status}' after ${result.expansions} expansions)`,
        board,
      );
    }
    traceBeams(h, result.beams);
    snapshot = h.snapshot();
    assertEqual(
      snapshot.screen,
      "solved",
      `solveGenerated: cascade board ${round + 1} solved by the solver's ` +
        "beams (specs/beams.md R9)",
    );
    await h.advance(1);
  }
  return snapshot;
}

/**
 * Trace a whole solution — one beam per channel, as the solver produces it.
 * Each beam's cell list starts at one of its channel's emitters, which is the
 * press that starts a segment-less beam (specs/controls.md).
 */
export function traceBeams(h: Harness, beams: Beams): void {
  for (const channel of CHANNELS) {
    const beam = beams[channel];
    if (beam !== undefined && beam.length > 0) {
      traceCells(
        h,
        beam.map((cell) => ({ col: cell.col, row: cell.row })),
      );
    }
  }
}

/* ---- Colour --------------------------------------------------------------- */
//
// Every reading below is the package's, bound to this case's geometry. The pure
// halves — what a colour distance is, how a cluster is placed, which of several
// samples is the medoid — live in `./case-harness/color` and are shared with the
// other two projects, so none of them can drift on what a threshold means. What
// is stated here is only what is Refract's: which patches of bench are
// candidates, and what "the barest of them" means for this case.

/**
 * The rendered colour at a logical point, averaged over a small cluster: the
 * centre pixel plus four neighbours 4 px out. A node's drawn form fills
 * NODE_R (30) of its centre, so the whole cluster stays inside it, and one
 * stray anti-aliased pixel cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleClusterColor(h as EnginePointReader, x, y);
}

/**
 * The build's exported `BACKGROUND`, rasterized: the color the engine clears
 * the whole canvas to each frame, read back through the same canvas
 * implementation the harness samples with. The fill is repeated so a
 * translucent color reads as the engine's frame-over-frame compositing leaves
 * it.
 */
export function clearColor(): Rgb {
  return rgbOf([...rasterize(BACKGROUND), 255]);
}

/**
 * Candidate patches of bare bench, in logical units, clear of the largest
 * board's extent (x 352..928, y 152..632 centre to centre, specs/board.md)
 * with NODE_R to spare, and away from the top heading band and the bottom
 * footer where a build's readouts most plausibly sit.
 */
export const BACKGROUND_POINTS: readonly Point[] = [
  { x: 160, y: 392 },
  { x: 1120, y: 392 },
  { x: 160, y: 500 },
  { x: 1120, y: 280 },
];

/**
 * The bench's background colour, sampled off the canvas as it stands: the
 * medoid of the {@link BACKGROUND_POINTS} samples — the one closest to the
 * others in total — so one patch a build happens to decorate (a readout, a
 * flourish) cannot stand in for the bench. Refract fixes no palette, so
 * nothing here assumes the bench is dark or light.
 *
 * NOT THE SAME RULE AS THE STRUCTURED-2D PROJECT'S, which takes the sample
 * NEAREST the rasterized clear colour over four patches of its own. Both answer
 * "the barest of these" and they answer it differently, so the two are separate
 * readings in the package (`medoidOf` and `nearestTo`) and each project binds
 * the one its verdicts were taken under.
 */
export function sampleBackground(h: Harness): Rgb {
  return medoidOf(
    BACKGROUND_POINTS.map((point) => sampleColor(h, point.x, point.y)),
  );
}

/** The centre of cell (col, row) on a cols x rows board (specs/board.md). */
export function nodeCenter(
  col: number,
  row: number,
  cols: number,
  rows: number,
): Point {
  return { x: cellX(col, cols), y: cellY(row, rows) };
}

/**
 * A board's drawn extent in logical units: the outermost cell centres plus
 * NODE_R on every side, which is where specs/board.md says every node's form
 * stops. The readout checks hold text clear of this box.
 */
export function boardExtent(
  cols: number,
  rows: number,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: cellX(0, cols) - NODE_R,
    y0: cellY(0, rows) - NODE_R,
    x1: cellX(cols - 1, cols) + NODE_R,
    y1: cellY(rows - 1, rows) + NODE_R,
  };
}

/* ---- Reading one frame's render ------------------------------------------- */
//
// All four readings are the package's, which walks the frame's calls once and
// places each text draw through the transform the recorder took at it. What this
// file adds is the conversion out of canvas pixels and into the stage's logical
// units, which is where every figure a check states is stated. At the harness's
// default shape the two coincide; at any other they do not, and a check that
// runs at another shape reads what it meant either way.

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return rawDrawnText(calls);
}

/**
 * Whether the frame spelled `text` inside some logical run of text, ignoring
 * case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words. Read off
 * the logical RUNS rather than off the raw calls, so a heading letter-spaced a
 * glyph per `fillText` is found by the words it spells.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  return spelledText(calls, text);
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
 * A build may anchor its text through any transform it applies and align it any
 * way it likes, so the anchor is mapped through the transform the context held
 * at the call and the run is extended about it by its measured width and
 * `textAlign`.
 *
 * The OVERLAY's text is in here too when the overlay is up: the runtime draws it
 * through the same context this harness records.
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
 * exactly as {@link drawnTextSpans} reports it.
 */
export function drawnTextRuns(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), reanchoredTextRuns(h.calls));
}

/* ---- The diagnostics overlay ---------------------------------------------- */

/**
 * Toggle the engine's debug overlay and run the frame that draws it.
 *
 * The engine owns the toggle: its own `keydown` listener on the surface's
 * event target reads the backtick (`Backquote`), outside the game's action
 * registry, so this is the same gesture a player makes. The overlay is drawn
 * after `render` through the same context the harness records, so the lines
 * it draws — one `fillText` of `` `${name}: ${value}` `` per registered
 * diagnostic source — land in `h.calls` like any other text. (It stays out of
 * `captureReplay` recordings: the engine closes its recorder before the
 * overlay draws, which is right — the overlay is chrome, not the build's
 * picture.)
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
 * A stage point inside no target on the screen, found rather than assumed: the
 * build owns its layout, so a gesture that must take nothing has to end
 * somewhere the build itself says is free (specs/controls.md: a release
 * anywhere but the armed target takes nothing).
 */
export function pointOutsideEveryTarget(
  targets: readonly TargetSnapshot[],
): Point {
  for (let y = 4; y < STAGE_H; y += 16) {
    for (let x = 4; x < STAGE_W; x += 16) {
      const probe = { id: "probe", x, y, w: 1, h: 1 };
      if (!targets.some((target) => targetsOverlap(target, probe))) {
        return { x, y };
      }
    }
  }
  return fail(
    "a stage point inside no target",
    targets.map((target) => target.id),
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
