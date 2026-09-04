// Refract — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, and its own `window.__refract` — and
// the only place all of that exists is a page that has loaded the bundle. So the
// project serves `dist/`, loads it in Chromium, and reaches the game the way
// anything reaches it: over the surface the specification told the build to
// install.
//
// THE MACHINERY THAT DOES THAT IS NOT REFRACT'S. Serving the build, connecting to
// the one browser, opening a page per harness, injecting the draw-command
// recorder and the audio probe, bracketing each driven frame around one step of
// the build's surface, reading pixels and draw calls back out, and writing the
// evidence a review point declares — every engineless case needs exactly that,
// and it lives once, in `@test-cabinet/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Refract's: the shape
// of its snapshot, the operations its `specs/instrumentation.md` requires, and
// the scenario helpers that pose a board, walk a course, and draw a beam.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Refract's names and Refract's types on it — so the suites next door go on
// importing `createHarness`, `captureReplay` and `watchCues` from `../harness`
// exactly as they did, and none of them can tell the difference.
//
// WHAT A CHECK READS. The game's own state (through `window.__refract`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the pixels those operations left on the canvas,
// and the sounds the build emitted. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the world through the surface, and the real
// rules the build wrote decide everything from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number. The POINTER
// needs no frames at all: `specs/instrumentation.md` makes `pointerDown`,
// `pointerMove`, `pointerUp`, and `trace` take effect the moment they are called,
// so a whole route — a whole campaign course — is drawn without advancing the
// game, and a frame is driven only where something is genuinely per-frame: a
// render to sample, a cue to hear, a key to deliver.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than reading the state in process. The scenarios, the tolerances, and
// the assertions are the same ones, because they are the case's rather than the
// runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCaseHarness,
  darkestOf,
  mouseGlide,
  mousePress,
  mouseRelease,
  rectCenter,
  rectsOverlap,
  type Harness as BaseHarness,
  type Point,
  type Rgb,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import { ACTION_KEYS, OVERLAY_KEY, type ActionName } from "./constants";
import {
  CHANNELS,
  STAGE_H,
  STAGE_W,
  cellCenter,
  parseBoard,
  boardToNotation,
  type Board,
  type Channel,
} from "./notation";
import type { Beams, Cell } from "./rules";
import { solve, type SolveResult } from "./solver";
import { CAMPAIGN_BOARDS } from "./routes";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__refract";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
 *
 * Written out in full rather than spread over the shared harness's
 * `BASE_REQUIRED_OPS`: this list is what a build is told to install, in the order
 * the specification introduces them, and it is the order a missing-operation
 * fault names them back in.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "startMode",
  "loadBoard",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "trace",
  "clear",
] as const;

/** The version the surface reports (`REFRACT_DEBUG_VERSION`). */
export const REFRACT_DEBUG_VERSION = 2;

/** The screens the game can be on. */
export type Screen =
  | "title"
  | "howto"
  | "select"
  | "playing"
  | "solved"
  | "complete";

/** The two ways to play. */
export type Mode = "campaign" | "cascade";

/** One node, as a snapshot reports it. */
export interface SnapshotNode {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: "emitter" | "lens" | "crystal";
  channel: Channel | null;
  charges: number | null;
  spent: number | null;
}

/** The board a snapshot reports. */
export interface SnapshotBoard {
  cols: number;
  rows: number;
  nodes: SnapshotNode[];
}

/** One channel's beam, as a snapshot reports it. */
export interface BeamView {
  cells: { col: number; row: number }[];
  complete: boolean;
}

/** The state a snapshot reports, as `specs/instrumentation.md` documents it. */
export interface RefractSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  menuIndex: number;
  boardIndex: number;
  solvedBoards: number[];
  unlockedCount: number;
  selectIndex: number;
  solvedCount: number;
  tier: number;
  board: SnapshotBoard;
  /** One entry per channel present on the board, none for an absent channel. */
  beams: Partial<Record<Channel, BeamView>>;
  solved: boolean;
  tracing: { channel: Channel; live: { col: number; row: number } } | null;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  /** The current screen's pointer targets, under the ids and in the order
   * specs/controls.md fixes for that screen. */
  targets: TargetSnapshot[];
  muted: boolean;
  simTime: number;
}

/** Which device drove the pointer, as `specs/controls.md` names them. */
export type PointerDevice = "mouse" | "pen" | "touch";

/**
 * One pointer target: the rectangle a screen is worked through, in the stage's
 * logical units, under the id `specs/controls.md` fixes for it.
 */
export interface TargetSnapshot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface RefractDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<RefractSnapshot>;
  startMode(mode: Mode): Promise<void>;
  loadBoard(board: readonly string[]): Promise<void>;
  pointerDown(x: number, y: number, device?: PointerDevice): Promise<void>;
  pointerMove(x: number, y: number, device?: PointerDevice): Promise<void>;
  pointerUp(device?: PointerDevice): Promise<void>;
  trace(cells: readonly { col: number; row: number }[]): Promise<void>;
  clear(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* What a snapshot is compared on                                             */
/* -------------------------------------------------------------------------- */

/**
 * A snapshot with every beam cell narrowed to the two fields the specs fix.
 *
 * specs/state.md declares `interface Cell { col, row }` and
 * specs/instrumentation.md's Snapshot shape writes `cells: [{ col, row }]`, so
 * `col` and `row` are what a cell means. Neither says a cell may carry nothing
 * else, and specs/state.md's contract grants the build fields that "hold derived
 * data you can rebuild from the declared ones" — a cell that also names its
 * node's kind or channel is exactly that. So every check compares on the two
 * fields the specs fix, and no check grades the rest either way. A cell missing
 * `col` or `row` still fails: the projection reads those two properties and
 * yields `undefined`.
 *
 * The snapshot the page returned is never touched. Every container the
 * projection rewrites is a fresh object, so a check holding an earlier snapshot
 * sees what it saw.
 *
 * Handed to the shared harness as its `projectSnapshot`, so it runs at every
 * point a snapshot crosses back out of the page — `h.snapshot()`,
 * `h.debug.snapshot()`, and the states a driven run reads — and no check can
 * hold an unprojected one. It is the same narrowing the `simple-2d` and
 * `structured-2d` harnesses apply at their own single read point, so a build
 * that passes there passes here.
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
        cells: (cells as { col: number; row: number }[]).map((cell) => ({
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
      const cell = live as { col: number; row: number };
      projected.tracing = {
        ...tracing,
        live: { col: cell.col, row: cell.row },
      };
    }
  }

  return projected;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */
//
// THE STEP SCHEDULE. The suite chooses the size of a frame, because the
// specification deliberately fixes none: every rate in this game is per second
// and is integrated against the elapsed time of the frame, so a build must reach
// the same place however that time was divided. Little rides on it in a
// pointer-driven puzzle — the pointer operations do not even need a frame — so
// the suite steps a plain 60 Hz, the rate a healthy display would have handed the
// build anyway. The one check that is ABOUT the step size
// (`instrumentation/advances-on-elapsed-time`) calls `advance` with its own
// divisions directly, through the surface.

/**
 * The shared harness, with Refract's snapshot, Refract's surface and Refract's
 * figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<RefractSnapshot, RefractDebugApi>({
  slug: "refract",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the suite's clock decides how long a frame is.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: 60,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a gesture delivered any other way would leave a perfectly good build silent.
  // Refract fixes no key binding this suite could trust to be inert — the menu
  // bindings are the build's own — so the gesture is a real mouse press in the
  // stage's top-left corner.
  //
  // IT IS NOT INERT, AND NOTHING HERE NEEDS IT TO BE. Every screen is worked from
  // the pointer, through targets the BUILD places (specs/controls.md), so a build
  // that seated a control in that corner has this press arm it and its release
  // take it. What makes the gesture safe is WHEN it is delivered: before the
  // harness's opening `reset`, which restores every declared field of the state,
  // so a menu it moved or a screen it left is gone before a check reads anything
  // — while the audio it opened is a fact about the page's user activation, which
  // no reset touches. And only a harness created with `armAudio: true` is handed
  // the gesture, so a check that is not about sound never presses this build.
  arm: { kind: "click", x: 2, y: 2 },
  // THIRTY SECONDS, AND THE ONLY READING IN THIS PROJECT THAT CANNOT BE TAKEN OFF
  // THE HOST'S CLOCK. A page boots in real time and there is no simulated clock to
  // read it against — the game does not exist yet, so it has no clock of its own
  // to have gained on — so this wait is a real one, and the rule for a real one is
  // that its allowance must be a length a LOADED host cannot cross, because
  // everything on the other side of it is charged to the build. A probe that
  // expires here does not report a slow host; it reports `window.__refract was
  // still absent`, which reads as a hard conformance verdict against a build that
  // installed its surface perfectly well — the worst shape a flake can take.
  //
  // Five seconds was that. On a host running nine of these projects at once, a
  // conformant reference lost `instrumentation/reset` to exactly this ceiling.
  // Thirty is chosen against the measured worst case rather than against a healthy
  // machine — instrumented time-to-surface over thirteen harnesses at load average
  // 73-120 ran 72 ms to 299 ms, so this is a hundred times the worst reading
  // actually taken — and the poll returns the instant the global appears, so a
  // conformant build is charged nothing for the headroom.
  //
  // EVERY PAGE PAYS THE WHOLE OF IT, and that is the point rather than an
  // oversight. It is tempting to let one page's expired wait stand in for the
  // rest, so that a build with no surface at all does not pay the ceiling once per
  // harness. That trade is the wrong way round: the only evidence such a memo
  // could rest on is a wait that expired, and a wait expires either because the
  // build installs nothing or because the host stalled — so trusting it turns ONE
  // unlucky page into a fabricated `still absent` on every harness after it. The
  // cost it would have saved was measured instead of guessed: a reference with the
  // one line that installs the surface removed validates in 705 s end to end,
  // install and build and all 94 points decided, against the twenty minutes the
  // runner caps the whole suite run at. Nearly all of that is idle waiting, eight
  // workers deep, which is why the figure barely moves with how busy the host is.
  surfaceTimeoutMs: 30_000,
  // Every beam cell narrowed to `col` and `row` before any check sees it, for
  // the reason on {@link projectCells}.
  projectSnapshot: projectCells,
  // Refract reads WHERE its copy sits, not only which strings were drawn — the
  // select grid's numbers cluster into rows and columns, a HUD figure is held
  // beside its label and clear of the board, and a heading letter-spaced a glyph
  // per `fillText` has to read as the one run it spells. All of that is measured
  // extent, so the harness measures each text call in the page.
  measureText: true,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  createHarness,
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

/**
 * Everything a check reads off one page running this build.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link RefractSnapshot} and whose `debug` is a
 * {@link RefractDebugApi}.
 */
export type Harness = BaseHarness<RefractSnapshot, RefractDebugApi>;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<RefractSnapshot>;

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  Pixel,
  Point,
  RecordedFrame,
  RecordedOp,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export {
  ConstantClock,
  callsTo,
  closeWorkerBrowser,
  colorDistance,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  drewText,
  mouseGlide,
  mousePress,
  mouseRelease,
  retable,
  sampleColor,
  setsOf,
  textDraws,
  thinReplay,
} from "./case-harness/index";

export type { Rgb, TextDraw, TextGeometry } from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* Colour sampling                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Candidate patches of bare bench, in logical units, clear of the largest
 * board's extent (`specs/board.md` puts every cell center inside x `352..928`,
 * y `152..632`, and every node inside `NODE_R` of its center) and of the edges
 * where a build most plausibly seats its heading and its readouts.
 *
 * The bench is dark and everything placed on it is drawn to be read against it
 * (`specs/overview.md`), but the readouts' exact placement is the build's, so
 * no single patch is guaranteed bare. The darkest of several is: anything
 * drawn to be read is lighter than the bench it sits on, so a patch something
 * covers reads lighter than one nothing does.
 */
export const BENCH_POINTS: readonly { x: number; y: number }[] = [
  { x: 200, y: 392 },
  { x: 1080, y: 392 },
  { x: 200, y: 600 },
  { x: 1080, y: 200 },
];

/**
 * The bare bench's colour: the darkest of the {@link BENCH_POINTS} patches,
 * sampled off the canvas as it stands.
 *
 * The shared reading's default sample radius is what this case wants: 4 logical
 * units out, comfortably inside `NODE_R` (30) when the point is a cell center,
 * so one stray anti-aliased or glow pixel cannot swing it.
 */
export function sampleBench(h: Harness): Promise<Rgb> {
  return darkestOf(h, BENCH_POINTS);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__refract` and then lets the
// real rules the build wrote decide everything from there. None of them asserts
// a verdict of its own; a helper fails only when the game is not even in the
// situation the caller's scenario needs, and then with the requirement named.

/**
 * Fire one registered action, through a real key press and the frame that
 * delivers it.
 *
 * `specs/controls.md` fixes only the `clear` binding (`KeyR`); of the rest it
 * requires that "each action carries the keys a player reaches for by habit",
 * and the habitual keys of a keyboard-only menu are the arrow cluster, Enter,
 * and Escape — the keys `constants.ts` pins per action. The press goes through
 * Chromium's own input pipeline, never through the surface, which carries no
 * operation for the registered actions at all: the menus are driven exactly the
 * way a player drives them.
 */
export async function fireAction(
  h: Harness,
  action: ActionName,
): Promise<void> {
  await h.tap(ACTION_KEYS[action]);
}

/** Show or hide the debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}

/**
 * Enter a mode the way its title menu item does, through the surface's
 * `startMode` — the pose `specs/instrumentation.md` defines as "exactly as
 * choosing its menu item does". The one frame after it is what puts the new
 * screen on the canvas.
 *
 * Through the pose rather than through the title menu's keys, deliberately: the
 * menu bindings are the build's own under this engine, so entering a mode by
 * key would hang every campaign and cascade check on a binding the
 * specification never fixed. The menu keys get their own checks in
 * `screens/`, where the binding is the subject.
 */
export async function startCampaign(h: Harness): Promise<void> {
  await h.debug.startMode("campaign");
  await h.advance(1);
}

/** See {@link startCampaign}. */
export async function startCascade(h: Harness): Promise<void> {
  await h.debug.startMode("cascade");
  await h.advance(1);
}

/**
 * Pose a board through `loadBoard`, in the notation `specs/board.md` defines,
 * and hand back the parsed board the caller measures against.
 *
 * The one frame after the pose is what draws it, so a caller can sample pixels
 * right away. The pose itself moves the game to `playing` with every beam empty
 * and no trace live.
 */
export async function loadBoard(h: Harness, notation: string): Promise<Board> {
  const board = parseBoard(notation);
  await h.debug.loadBoard(boardToNotation(board).split("\n"));
  await h.advance(1);
  return board;
}

/** The stage position of a cell's center on `board`, off the spec's formula. */
export function center(
  board: Pick<Board, "cols" | "rows">,
  cell: Cell,
): { x: number; y: number } {
  return cellCenter(cell.col, cell.row, board.cols, board.rows);
}

/** The midpoint of the segment joining two cells, in stage units. */
export function segmentMidpoint(
  board: Pick<Board, "cols" | "rows">,
  a: Cell,
  b: Cell,
): { x: number; y: number } {
  const ca = center(board, a);
  const cb = center(board, b);
  return { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
}

/**
 * Draw a route through the surface's `trace`: a press at the first cell's
 * center, a move to each remaining center, then a release, all resolved the
 * moment the call is made. A list the limits refuse part way through leaves the
 * beam ending at the last segment they permitted, which is itself a specified
 * behaviour a check can read back.
 */
export async function traceCells(
  h: Harness,
  cells: readonly Cell[],
): Promise<void> {
  await h.debug.trace(cells.map(({ col, row }) => ({ col, row })));
}

/** {@link traceCells} over a route stored as `[col, row]` pairs. */
export async function traceRoute(
  h: Harness,
  route: readonly (readonly [number, number])[],
): Promise<void> {
  await traceCells(
    h,
    route.map(([col, row]) => ({ col, row })),
  );
}

/**
 * Draw several routes through the surface's `trace`, then read the state they
 * left — ALL IN ONE CROSSING.
 *
 * The same operations in the same order as one {@link traceCells} per route
 * followed by a `snapshot`, and the build sees no difference: `trace` resolves a
 * route the moment it is called, between frames, so nothing runs between two of
 * them for a crossing to have separated. What changes is the cost. A crossing is
 * a round trip into a browser process, and a round trip is priced by how busy the
 * HOST is — 6 ms on an idle box and 90 ms on a loaded one — so a sweep that solves
 * twenty-five boards three channels at a time pays for a hundred of them in
 * latency that has nothing to do with the build. Sending the whole solution at
 * once takes that out of the reading, which is what keeps a sweep clear of the
 * per-check allowance on a loaded host (`vitest.config.ts` names the four points
 * that were lost to it).
 *
 * WHY THIS IS A CASE-LEVEL FUNCTION AND NOT A HARNESS METHOD. Batching is not a
 * general capability the shared harness offers — it is sound here only because
 * `specs/instrumentation.md` makes THIS case's `trace` resolve between frames, so
 * a batch and a run of singles reach the same state. The two things it has to
 * borrow from the harness it takes explicitly: the refusal a missing surface owes
 * every operation, and the same narrowing {@link projectCells} applies at the
 * harness's own single read point, so a check cannot tell a batched snapshot from
 * any other.
 */
export async function traces(
  h: Harness,
  routes: readonly (readonly Cell[])[],
): Promise<RefractSnapshot> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const returned = await h.page.evaluate(
    ([handle, list]) => {
      const api = (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[handle];
      for (const route of list) api.trace(route);
      return api.snapshot();
    },
    [
      HANDLE,
      routes.map((route) => route.map(({ col, row }) => ({ col, row }))),
    ] as const,
  );
  return projectCells(returned as RefractSnapshot);
}

/**
 * Draw a whole solution: one `trace` per channel present, in `CHANNELS` order,
 * and hand back the state they left.
 *
 * Each beam's route runs emitter to emitter, so each trace begins on the first
 * row of the grab table — an emitter of a channel whose beam carries no
 * segments — and the game's own rules accept or refuse every segment from
 * there. On the last permitted move of the last channel the board solves and
 * the trace ends on the spot, exactly as `specs/beams.md` states.
 *
 * The traces and the read-back go over in ONE crossing ({@link traces}), and the
 * snapshot that comes back IS the state after the solve: `trace` resolves between
 * frames, so nothing has run since. A caller that only wants the beams drawn may
 * still ignore it.
 */
export async function drawBeams(
  h: Harness,
  beams: Beams,
): Promise<RefractSnapshot> {
  const routes: Cell[][] = [];
  for (const channel of CHANNELS) {
    const route = beams[channel];
    if (route !== undefined && route.length > 0) {
      routes.push(route.map(({ col, row }) => ({ col, row })));
    }
  }
  return traces(h, routes);
}

/* ---- The real pointer ------------------------------------------------------ */
//
// The surface's pointer operations resolve a move the moment they are called,
// between frames — which is what makes course walks instant — but a CUE is
// played "on the frame its event happens, from update" (specs/ui.md), from the
// pointer samples the build's own input layer hands each update. So a check
// whose subject is what a frame did with a player's input — the audio points
// above all — drives Chromium's real mouse instead, one frame per sample, and
// reads the cue off the frame that consumed it. The mapping from stage units to
// CSS pixels is the harness's own fit, the identity at the default shape.

/**
 * Draw a route with the REAL mouse: a press at the first cell's center, a move
 * to each remaining center, then a release, one driven frame per sample.
 *
 * The slow sibling of {@link traceCells}, for the checks that read what a FRAME
 * did with the move — a cue sounding on it, a segment appearing in a replay —
 * rather than only where the beam ended up.
 */
export async function mouseTrace(
  h: Harness,
  board: Pick<Board, "cols" | "rows">,
  cells: readonly Cell[],
): Promise<void> {
  if (cells.length === 0) return;
  const first = center(board, cells[0]);
  await mousePress(h, first.x, first.y);
  for (const cell of cells.slice(1)) {
    const at = center(board, cell);
    await mouseGlide(h, at.x, at.y);
  }
  await mouseRelease(h);
}

/** Fail a scenario helper on the screen it needed and the screen it found. */
function requireScreen(
  snapshot: RefractSnapshot,
  wanted: Screen,
  doing: string,
): void {
  if (snapshot.screen !== wanted) {
    fail(
      `screen ${JSON.stringify(wanted)} (${doing})`,
      `screen ${JSON.stringify(snapshot.screen)}, mode ${JSON.stringify(snapshot.mode)}`,
    );
  }
}

/**
 * Solve the campaign board at `index` (0-based) as it stands on the `playing`
 * screen, by tracing the stored routes for that board.
 *
 * The routes come from `routes.ts`: precomputed from `specs/campaign-boards.md`
 * under the `specs/beams.md` rules by the case's own solver, and never from any
 * implementation. They solve the board AS SPECIFIED; a build playing a board of
 * its own invention refuses them somewhere, the board does not solve, and the
 * caller's assertions read exactly that back.
 */
export async function solveCampaignBoard(
  h: Harness,
  index: number,
): Promise<RefractSnapshot> {
  const data = CAMPAIGN_BOARDS[index];
  if (data === undefined) {
    fail(`a campaign board index 0..${CAMPAIGN_BOARDS.length - 1}`, index);
  }
  const beams: Beams = {};
  for (const channel of CHANNELS) {
    const route = data.routes[channel];
    if (route !== undefined) {
      beams[channel] = route.map(([col, row]) => ({ col, row }));
    }
  }
  return drawBeams(h, beams);
}

/** What a course walk saw: each board on entry, and the screen it ended on. */
export interface CourseWalk {
  /** The snapshot on entering each board, `playing` with every beam empty. */
  entered: RefractSnapshot[];
  /** The state after the last solve: `solved`, or `complete` after board 24. */
  final: RefractSnapshot;
}

/**
 * Really play the first `boards` boards of the campaign: enter the course from
 * the title, then solve board after board, crossing each `solved` screen
 * through its first choice (next board, `menuIndex` 0 on arrival).
 *
 * Campaign progress deliberately has NO pose (`specs/instrumentation.md`
 * carries none), so this is the one honest way to a later course state — and
 * because every trace is immediate, the whole course costs milliseconds. Call
 * it on a fresh harness (or straight after `reset`): it starts from the title.
 *
 * `onBoard` runs on each board's entry snapshot before that board is solved,
 * for a check that reads or captures mid-course.
 */
export async function driveCourse(
  h: Harness,
  boards: number,
  onBoard?: (snapshot: RefractSnapshot, index: number) => void | Promise<void>,
): Promise<CourseWalk> {
  await startCampaign(h);
  let snapshot = await h.snapshot();
  requireScreen(
    snapshot,
    "select",
    "entering the campaign puts the course's grid up",
  );
  // A fresh course arrives with the highlight on board 1, so the first confirm
  // enters it (specs/modes/campaign.md).
  await fireAction(h, "confirm");

  const entered: RefractSnapshot[] = [];
  for (let index = 0; index < boards; index += 1) {
    snapshot = await h.snapshot();
    requireScreen(
      snapshot,
      "playing",
      `board ${index + 1} of the course walk should be in play`,
    );
    entered.push(snapshot);
    await onBoard?.(snapshot, index);
    // The solution's own read-back IS the state after the solve: `trace` resolves
    // between frames, so nothing has run since and a second crossing for a
    // `snapshot` would read exactly what this already carries.
    snapshot = await solveCampaignBoard(h, index);
    if (index < boards - 1) {
      requireScreen(
        snapshot,
        "solved",
        `solving board ${index + 1} short of the last should land on solved`,
      );
      // First choice, highlighted on arrival: next board.
      await fireAction(h, "confirm");
    }
  }
  return { entered, final: snapshot };
}

/** The `board` a snapshot reports, restated as the scenario library's Board. */
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

/** What a cascade sweep saw, board by board. */
export interface CascadeSweep {
  /** Each generated board, as the snapshot reported it on arrival. */
  boards: Board[];
  /** The solver's verdict on each board, in order. */
  verdicts: SolveResult[];
  /** The snapshot after each board's solution was traced. */
  afterSolve: RefractSnapshot[];
}

/**
 * Play `count` boards of a cascade run seeded with `seed`: reset, start the
 * sequence, and for each board read it back, solve it with the case's own
 * spec-derived solver, trace the solution, and cross the solved screen through
 * NEXT BOARD (`SOLVED_ITEMS[0]`, highlighted on arrival).
 *
 * Solvability is proven BY SOLVING: the solver is derived from `specs/beams.md`
 * alone, so a board it cracks is solvable under the specification, whatever the
 * build believes. Nothing here asserts — the sweep's record is handed back, and
 * the caller holds it against its own point: a board the solver called
 * unsolvable, a trace the build refused, a screen that never advanced all
 * surface in `verdicts` and `afterSolve`.
 *
 * `onBoard` runs after each board's arrival snapshot is read and before its
 * solution is traced.
 */
export async function solveGenerated(
  h: Harness,
  count: number,
  seed: number,
  onBoard?: (snapshot: RefractSnapshot, index: number) => void | Promise<void>,
): Promise<CascadeSweep> {
  await h.debug.reset({ seed });
  await h.advance(1);
  await startCascade(h);

  const boards: Board[] = [];
  const verdicts: SolveResult[] = [];
  const afterSolve: RefractSnapshot[] = [];
  for (let index = 0; index < count; index += 1) {
    let snapshot = await h.snapshot();
    requireScreen(
      snapshot,
      "playing",
      `board ${index + 1} of the cascade sweep should be in play`,
    );
    const board = boardFromSnapshot(snapshot);
    boards.push(board);
    await onBoard?.(snapshot, index);
    const verdict = solve(board);
    verdicts.push(verdict);
    // The solution's own read-back IS the state after the solve: `trace` resolves
    // between frames, so nothing has run since. A board the solver could not crack
    // is read back as it stands, unsolved, for the caller's own verdict.
    snapshot =
      verdict.status === "solved"
        ? await drawBeams(h, verdict.beams)
        : await h.snapshot();
    afterSolve.push(snapshot);
    if (index < count - 1 && snapshot.screen === "solved") {
      // First choice, highlighted on arrival: NEXT BOARD.
      await fireAction(h, "confirm");
    }
  }
  return { boards, verdicts, afterSolve };
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

/**
 * The middle of a target, which is where every pointer check aims.
 *
 * A {@link TargetSnapshot} IS a rectangle in the shared readings' sense — it
 * carries `x`, `y`, `w` and `h` beside what else it reports — so this and
 * {@link targetsOverlap} name the shared geometry rather than restating it.
 */
export function targetCenter(target: TargetSnapshot): Point {
  return rectCenter(target);
}

/** Whether two target rectangles share any area. */
export function targetsOverlap(a: TargetSnapshot, b: TargetSnapshot): boolean {
  return rectsOverlap(a, b);
}

/**
 * Press at a point, release at another, and settle a frame — the gesture every
 * target is taken by. Both points are in the stage's logical units, and the
 * release defaults to the press.
 */
export async function pressRelease(
  h: Harness,
  press: { x: number; y: number },
  release: { x: number; y: number } = press,
  device: PointerDevice = "mouse",
): Promise<void> {
  await h.debug.pointerDown(press.x, press.y, device);
  if (release.x !== press.x || release.y !== press.y) {
    await h.debug.pointerMove(release.x, release.y, device);
  }
  await h.debug.pointerUp(device);
  await h.advance(1);
}
