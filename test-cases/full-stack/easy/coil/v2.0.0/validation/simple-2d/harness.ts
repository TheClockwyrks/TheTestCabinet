// Coil — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT COIL'S. Building the canvas and the
// recorder over it, constructing the engine, reading the debug surface off it and
// standing in for a missing one, threading a PURE surface through `engine.apply`,
// stamping the cues the engine announces, serving the produced tree to the
// engine's loader, reading pixels and text back out, and writing the evidence a
// review point declares — every engine-backed case needs exactly that, and it
// lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Coil's: its board
// arithmetic, its blit reading, the sentence a missing surface is failed against,
// its tick vocabulary, and every scenario that poses this game.
//
// The seam is one call. `createEngineCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object — including the engine itself,
// which the package names nowhere — and hands back the machinery with Coil's
// names and Coil's types on it. The suites next door go on importing
// `createHarness`, `poseScene`, `arrangeEat` and the rest from `../harness`
// without knowing which half of the machinery each belongs to.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: `setSnake`
// poses a chain, the three driver switches hold one faculty still while another
// is watched, and `reset` gives everything back. Posing through it is how a
// scenario is arranged from code, and it is the seam the case's specification
// documents. `surface.ts` is that specification as types, and it is the only
// description of the surface this project holds: the build's own module for it is
// never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the engine
// holds the second element and returns it from `engine.debug`. The package's
// `readDebugSurface` does that read and stands an `absentSurface` in when there is
// nothing to read, so a build that returned no surface fails the checks that reach
// the game through it rather than the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a simple
// engine's state model forces. The engine holds the state BY VALUE and hands it
// out read-only, so the surface is pure: a pose is `(state, ...args) => CoilState`
// and a reading is `(state, ...args) => R`, and neither can be called by a check
// directly because neither has the state. The package's `applyDriver` supplies
// it — a reading is handed `engine.state` FOLLOWED BY the arguments the check
// passed, which is what makes an indexed reading like `menuItemRect(index)` mean
// what it says, and a pose is run through `engine.apply` so the state it returns
// is the state the next frame receives. `surface.ts`'s `READINGS` is what tells
// the two apart, because nothing about a pure surface distinguishes them at run
// time.
//
// WHAT THE HARNESS OWNS THAT THE SURFACE MUST NOT. The surface is ATOMIC by
// design — one field per operation — so every compound sequence lives here:
// opening a round, reaching a screen, staging a scenario, and the ISOLATION
// helpers that clear the world and place back only what a requirement is about,
// together with the three per-faculty gates `specs/instrumentation.md` states.
// {@link poseScene} is where they are all spoken in one breath.
//
// RECONCILING AFTER A POSE. `specs/instrumentation.md`'s `reconcile()` brings
// every reading the surface reports into agreement with the game as it stands,
// without advancing anything — so a build that keeps a reading as a stored copy
// of something a pose can leave behind answers for the world the scene posed
// rather than for the one before it. A helper here that poses anything a reading
// derives from calls it before it returns, so a check that poses through the
// helpers never calls it itself. A check that poses with `h.debug.set…` directly
// and then reads calls it once, before its first read.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type PointerButton,
  type PointerDevice,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  applyDriver,
  createEngineCaseHarness,
  installAssetHost,
  installAudioContext,
  tolerantAudioBuffer,
  type AssetHost,
  type EngineHarness,
  type EngineHarnessOptions,
  type TimedCue,
  type PureDriver,
} from "./case-harness/engine/index";
import { makeReplayCapture } from "./case-harness/engine/2d";
import {
  callsTo,
  imageRef,
  setsOf,
  type DrawCall,
} from "./case-harness/draw-calls";
import {
  IDENTITY,
  apply as applyMatrix,
  numbers,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import type { Point } from "./case-harness/point";
import { drawnText, textDraws, type TextDraw } from "./case-harness/text";
import {
  BOARD_X,
  BOARD_Y,
  CELL,
  INTERIOR_COL_MAX,
  INTERIOR_ROW_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MIN,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_SECONDS,
} from "./constants";
import { BACKGROUND, game as build, type CoilState } from "../src/game";
import { fail } from "./assert";
import {
  OBSTACLE_OPS,
  READINGS,
  type Cell,
  type CoilDebugApi,
  type CoilSnapshot,
  type MenuRect,
  type Dir,
  type Screen,
} from "./surface";

export type { Cell, CoilSnapshot, Dir, Screen };

/* The readings this project takes straight off the package, under its names. */
export type { DrawCall, Point, Rgb, TextDraw };
export { callsTo, colorDistance, drawnText, setsOf, textDraws };

/** The case's surface, bound to the state type the build declared. */
export type CoilSurface = CoilDebugApi<CoilState>;

/**
 * The surface as every check drives it: every member of the pure surface, minus
 * its state argument, over the engine that holds the state.
 *
 * Optional members stay optional, so the mode-only `clearObstacles` is still
 * `h.debug.clearObstacles?.()` — though a check about the obstacle course reaches
 * it through {@link obstacleSurface} instead, which says what is missing.
 */
export type CoilDriver = PureDriver<
  DeepReadonly<CoilState>,
  CoilState,
  CoilSurface
>;

/** The engine this project stands a build up on. */
export type CoilEngine = Engine<CoilState, CoilSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<CoilState, CoilSurface>` here and the engine is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<CoilState, CoilSurface>;

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the length of a frame, because the specification
// deliberately fixes none: `specs/movement.md` puts the game on a fixed TICK of
// `TICK_SECONDS`, fed by whatever elapsed time the engine hands each update and
// carrying the remainder, so a build must reach the same place however that time
// was divided into frames.
//
// The choice here is 64 Hz, and the reason is exactness. A tick is then EIGHT
// frames, a frame is `0.015625` s, and both are exact in binary floating point —
// so a check that asks for twenty-eight ticks of game time hands the build
// exactly `3.5` s of it, and the tick a combo window lapses on is decided by the
// build's arithmetic rather than by the last bit of ours. Every duration this
// specification states is a whole number of these frames: the combo window is
// 224, the bite is 16. A tick's worth of frames is also strictly more than one,
// which matters: a clock whose frame IS a tick sits exactly on the boundary a
// build's accumulator compares against, and a suite has no business deciding a
// point on the last bit of that comparison.
//
// A FRAME AND A TICK ARE DIFFERENT UNITS HERE, and every name below says which
// it counts. The package's own tick arithmetic writes `frames` and `ticks` over
// ONE counter — the two words are synonyms there, for the cases whose frame IS
// their tick — so none of it is bound: `FRAMES_PER_TICK` would be `1` under that
// reading and every duration in this project would be eight times short.
//
// The checks that are ABOUT the subdivision (`movement/subdivision-invariant`,
// `movement/sub-tick-update-runs-no-tick`) build harnesses with clocks of their
// own, which {@link HarnessOptions.clock} is for.

/** Frames the harness drives per second of game time. */
export const FRAME_HZ = 64;

/** One frame of game time, in milliseconds. Exact in binary: `15.625`. */
export const FRAME_MS = 1000 / FRAME_HZ;

/** Frames of the harness's clock one tick of the simulation covers. */
export const FRAMES_PER_TICK = Math.round(TICK_SECONDS * FRAME_HZ);

/** Frames covering `ticks` whole ticks of simulation time. */
export function tickFrames(ticks: number): number {
  return ticks * FRAMES_PER_TICK;
}

/** Frames covering `seconds` of simulation time, rounded up to a whole frame. */
export function secondFrames(seconds: number): number {
  return Math.ceil(seconds * FRAME_HZ - 1e-9);
}

/* -------------------------------------------------------------------------- */
/* The board, as the specification lays it out                                */
/* -------------------------------------------------------------------------- */
//
// `src/constants.ts` is the CASE's own file, seeded into the workspace, so the
// figures below are read from it rather than restated. What is not in it is the
// arithmetic over a direction, because the build owns how it walks the grid —
// so the two tables a scenario needs are declared here, from `specs/board.md`
// and `specs/movement.md`, and never imported from a build's own module.

/** Every direction, in the order `specs/movement.md` lists them. */
export const DIRECTIONS: readonly Dir[] = ["up", "down", "left", "right"];

/** The cell offset one step along each direction: y grows downward. */
export const STEP: Readonly<Record<Dir, Cell>> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

/** The direction opposite each, which is the reversal a turn may not make. */
export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** The logical centre of cell `(col, row)`, as `specs/board.md` places it. */
export function cellCenter(col: number, row: number): Point {
  return {
    x: BOARD_X + col * CELL + CELL / 2,
    y: BOARD_Y + row * CELL + CELL / 2,
  };
}

/** Whether `(col, row)` is an interior cell, which is any cell not a wall cell. */
export function isInterior(col: number, row: number): boolean {
  return (
    col >= INTERIOR_COL_MIN &&
    col <= INTERIOR_COL_MAX &&
    row >= INTERIOR_ROW_MIN &&
    row <= INTERIOR_ROW_MAX
  );
}

/** Whether the two name the same cell. */
export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Whether `cells` holds `cell`. */
export function holdsCell(cells: readonly Cell[], cell: Cell): boolean {
  return cells.some((held) => sameCell(held, cell));
}

/** The cell `n` steps along `dir` from `cell`. */
export function ahead(cell: Cell, dir: Dir, n = 1): Cell {
  return {
    col: cell.col + STEP[dir].col * n,
    row: cell.row + STEP[dir].row * n,
  };
}

/**
 * A straight chain of `length` cells with its head at `head`, laid out behind it.
 *
 * The body trails OPPOSITE `dir`, which is where a snake that arrived travelling
 * that way left it, so the chain a check poses is one the game could have
 * reached by playing. `specs/board.md` requires each cell after the first to be
 * orthogonally adjacent to the one before it, which this satisfies by
 * construction.
 */
export function chainFrom(head: Cell, dir: Dir, length: number): Cell[] {
  const back = OPPOSITE[dir];
  const cells: Cell[] = [];
  for (let i = 0; i < length; i += 1) cells.push(ahead(head, back, i));
  return cells;
}

/**
 * A cell of the wall border, on the left edge halfway down.
 *
 * `specs/board.md` makes the border one cell thick on all four sides, so column
 * `0` is border at every row, and the mid-height row is as far from a corner as
 * the board goes.
 */
export const WALL_CELL: Cell = {
  col: 0,
  row: Math.floor((INTERIOR_ROW_MIN + INTERIOR_ROW_MAX) / 2),
};

/**
 * An interior cell the posed board leaves empty: no snake segment, no pellet, no
 * obstacle, and none of `exclude`.
 *
 * Scanned in a fixed order from the board's top-left, so the same posed scene
 * always yields the same cell and a failing check replays. A board with no empty
 * interior cell at all is the board-cleared ending rather than a scene a check
 * samples, so finding none fails loudly here rather than returning a cell that
 * is not empty.
 */
export function emptyInteriorCell(
  snapshot: CoilSnapshot,
  exclude: readonly Cell[] = [],
): Cell {
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row += 1) {
    for (let col = INTERIOR_COL_MIN; col <= INTERIOR_COL_MAX; col += 1) {
      const cell = { col, row };
      if (holdsCell(snapshot.snake, cell)) continue;
      if (snapshot.pellet !== null && sameCell(snapshot.pellet, cell)) continue;
      if (holdsCell(snapshot.obstacles, cell)) continue;
      if (holdsCell(exclude, cell)) continue;
      return cell;
    }
  }
  return fail(
    "an empty interior cell on the posed board",
    "every interior cell carries the snake, the pellet or an obstacle",
  );
}

/**
 * Every interior cell in one contiguous path, row by row and alternating
 * direction.
 *
 * A boustrophedon: left to right along row 1, right to left along row 2, and so
 * on. Consecutive cells are orthogonally adjacent within a row by construction,
 * and between rows because a row ends directly above where the next begins — so
 * the whole path is a chain `setSnake` accepts.
 */
export function serpentine(): Cell[] {
  const path: Cell[] = [];
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row += 1) {
    const rightwards = (row - INTERIOR_ROW_MIN) % 2 === 0;
    for (let i = INTERIOR_COL_MIN; i <= INTERIOR_COL_MAX; i += 1) {
      const col = rightwards ? i : INTERIOR_COL_MAX - (i - INTERIOR_COL_MIN);
      path.push({ col, row });
    }
  }
  return path;
}

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the build load every produced sprite and sound through
// the engine, which resolves each path under `assets/` relative to the page the
// build is served from and fetches it. This project runs in a Node process with
// no page, so nothing resolves that relative URL unless something here does. The
// package's asset host is what does: it stands `fetch`, `createImageBitmap` and
// `ImageBitmap` up over the workspace on disk, and remembers which produced file
// each decoded bitmap came from, which is the identity {@link Blit} carries.
//
// That is the same kind of thing the harness's canvas, surface metrics and clock
// are — the HOST the engine runs on — and without it the build is asked to draw
// from art nobody gave it. Every produced file is stood up for every check this
// project runs: nothing here withholds a path, refuses a request, or offers a
// switch that leaves the art out.
//
// THE AUDIO IS SERVED TOO, THROUGH AN `AudioContext` THIS FILE INSTALLS. A cue
// travels the same road a sprite does and then one step further: `loadAudio`
// fetches the produced file through the same transport and decodes it through a
// Web Audio context, and a bare Node process has neither half. Without both, every
// cue's load rejects — and `specs/ui.md` has the build define its four cues from
// `initialize` and play them by name from a tick. The engine's bus binds a name
// ONLY once its decode has succeeded and throws `unknown audio cue "<name>"` for
// a name nothing bound, so a build that binds its cues from its produced files
// alone either never finishes initializing or falls over inside its own update on
// the first pellet it eats. Either way every point in this project would fail for
// a fact about Node rather than about the build, which is the one thing a host is
// here to prevent. The decode note below says which half of the decode this case
// binds, and why that half is not the package's to choose.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the package's, because it has
 * to name the same directory in both layouts this file lives in: the case's own
 * `validation/<engine>/`, and the `validation/` the runner stages that directory
 * to inside the build's tree. The package is staged one level DEEPER than this
 * file, so a root derived there would address every produced output one directory
 * too far down — silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * The workspace, served to the engine's loader for the life of this process.
 *
 * ONE ROOT, AND THE ROOT ORDER IS STATED RATHER THAN DEFAULTED. `specs/assets.md`
 * has the build write its produced files under `assets/` in the workspace itself,
 * so a page-relative URL is looked for there and nowhere else. The package's
 * default would also look under `public/` and `dist/`, which for this case are
 * either absent or hold a STAGED copy of the same tree — and a root order that
 * answered from the second copy would grade a build on a file it did not just
 * produce, with nothing to say so.
 *
 * Installed once at module scope rather than per harness, and never uninstalled:
 * a Node process has no page for a relative URL to resolve against and no image
 * decoder at all, so this is what the host LACKS rather than something a single
 * check borrows. The handle is kept for {@link sourceId}.
 */
const assets: AssetHost = installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: ["."],
  // The honest answer a served page gives for a file the build never produced,
  // and what makes the engine announce `asset:failed` with a status.
  onMissing: "404",
  // The engine's loader decodes a fetched body through `createImageBitmap`, and
  // the engine's own recorder recognizes a drawable source by `instanceof`
  // against the host's constructors — of which a bare Node process has none. Both
  // halves are needed for a produced sprite to be drawn AND to reach a replay as
  // its pixels rather than as an opaque marker.
  images: true,
  label: "coil",
});

// THE CUES' HALF OF THE HOST. Installed beside the transport that fetches them
// because the two halves of a load are no use apart: the fetch answers the bytes
// and the decode is what binds the name the build then plays by. The stand-in
// context makes no noise and answers an inert node for every graph member the
// engine's synthesizer reaches for, so what it buys is not audio but the BINDING —
// `audio.load` sets a name only after its file has decoded, and a name nothing
// bound throws from `play`. A build is graded on the cue it asked for, which the
// bus announces either way, and never on a sample read back off the buffer.
//
// WHICH DECODE, AND WHY THE TOLERANT ONE. The package refuses to default this,
// because the two halves grade a build differently: `wavAudioBuffer` parses the
// RIFF container and THROWS on a body that is not one, while
// `tolerantAudioBuffer` answers silence of a nominal length instead and never
// throws. Under the throwing half a build that shipped one malformed cue leaves
// that name unbound, the engine's `play` then throws from inside the build's own
// update, and a single bad file costs every point in this project rather than the
// `audio/*-file-produced` point it belongs to — the same inversion this whole host
// exists to prevent, landing on the points that exist to report the file. Coil
// grades its produced files itself, off disk, in `audio/sounds.ts`, and nothing in
// this project ever reads a sample back off the buffer, so nothing is lost by
// letting a bad one bind: it is named as a bad file exactly where it should be.
//
// AND IT IS THE `structured-2d` PROJECT'S DECODER, WHICH IS NOT A COINCIDENCE. The
// same build is stood up under both engines from the same specification, and a cue
// that bound under one and not the other would move points for a reason belonging
// to neither the build nor the spec. The two calls are meant to stay the same text.
//
// Installed once at module scope and never uninstalled, for the reason the asset
// host is: a Node process has no Web Audio at all, so this is what the HOST lacks
// rather than something a single check borrows. The package reference-counts the
// global, so a second harness in the same worker joins this one.
installAudioContext({ decode: tolerantAudioBuffer });

/**
 * The produced file a drawn source came from, or `""` for one this harness never
 * served.
 *
 * `""` rather than `null` so the identity of every blit is a string a check can
 * compare, and so a build that drew a canvas it painted itself is reported as
 * having drawn something other than the produced file rather than as having
 * drawn nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return assets.sourceOf(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* Blits: which produced sprite landed on which cell                          */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the snake drawn from produced sprites, one per cell,
// "rotated in quarter turns when it is drawn" and sampled with image smoothing
// off. None of that can be read off the picture: a sprite authored backwards and
// a renderer that turns it backwards compose to the right picture, and a smoothed
// blit of pixel art at the stage's own scale is indistinguishable from an
// unsmoothed one. So a blit is read off the OPERATIONS the frame issued, which is
// where the turn and the flag are.
//
// This is Coil's own reading and stays with the case. The package's `imageDraws`
// walks the same operations for the same three `drawImage` forms, but it answers
// a destination box taken from two corners and carries neither the turn nor the
// smoothing flag — so it is a different reading of the same calls, and folding
// them would drop exactly the two facts the points here are about.

/**
 * How far from an exact quarter turn a transform may sit and still be read as
 * one, in quarter turns.
 *
 * A thousandth of a quarter turn is about a twelfth of a degree: far below
 * anything a build could mean by an orientation, and far above the dust a
 * composition of a letterbox fit, a translate and a rotate leaves behind.
 */
const QUARTER_TOLERANCE = 1e-3;

/**
 * One bitmap the build blitted.
 *
 * `id` is the source's identity: the path the bitmap's bytes were served from, as
 * the engine resolved it under the asset root — so `assets/snake/body.png` —
 * which means two blits carry the same one exactly when they painted the same
 * produced file. `""` names a source this harness never served, which is a canvas
 * or an image the build made for itself. The rectangle is in DEVICE pixels,
 * mapped through the transform in force at the call, and `x + w / 2, y + h / 2`
 * is its centre under any transform the build drew under — which is what makes a
 * blit attributable to a cell even when it was drawn under the quarter turns
 * `specs/assets.md` has a sprite drawn with.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
  /**
   * The quarter turns the blit carried the sprite's OWN `+x` axis through, or
   * `null` when the transform was not a whole number of quarter turns.
   *
   * `0` is the sprite drawn the way it was authored, `1` a quarter turn toward
   * `down`, `2` a half turn, `3` a quarter turn toward `up` — the same order
   * `right`, `down`, `left`, `up` runs in on a y-down canvas. `specs/assets.md`
   * authors each sprite in ONE orientation and has it "rotated in quarter turns
   * when it is drawn", and this is the turn it was drawn under. The picture on
   * the canvas cannot answer that on its own: a sprite authored backwards and a
   * renderer that turns it backwards compose to the right picture, and only the
   * turn itself tells the two halves apart.
   */
  quarterTurns: number | null;
}

/**
 * The quarter turns a transform carries the `+x` axis through, or `null` for a
 * transform that is not a whole number of quarter turns.
 *
 * Read off the LINEAR part alone — the sprite's `+x` axis lands on `(a, b)` — so
 * the translate that puts the sprite on its cell and the uniform scale of the
 * letterbox fit contribute nothing. A reflection is measured the same way and is
 * not rejected here: what a check about facing needs to know is where the edge
 * that was authored on the right ended up, and that is exactly what the image of
 * `+x` says.
 */
function quarterTurnsOf(m: Matrix): number | null {
  const [a, b] = m;
  if (!(Math.hypot(a, b) > 0)) return null;
  const turns = Math.atan2(b, a) / (Math.PI / 2);
  const nearest = Math.round(turns);
  if (Math.abs(turns - nearest) > QUARTER_TOLERANCE) return null;
  return ((nearest % 4) + 4) % 4;
}

/**
 * The destination rectangle of a `drawImage` call, in the space it was issued in,
 * or `null` for a call whose arguments are not one of the three forms.
 *
 * A two-argument placement takes its size from the source, which is why the
 * source's own dimensions are read: a build that blits a sprite at its natural
 * size names no size at all.
 */
function destinationOf(
  args: readonly unknown[],
): { x: number; y: number; w: number; h: number } | null {
  const rest = args.slice(1);
  const nine = numbers(rest, 8);
  if (nine !== null) return { x: nine[4], y: nine[5], w: nine[6], h: nine[7] };
  const five = numbers(rest, 4);
  if (five !== null && rest.length === 4) {
    return { x: five[0], y: five[1], w: five[2], h: five[3] };
  }
  const two = numbers(rest, 2);
  if (two === null || rest.length !== 2) return null;
  const source = args[0] as { width?: unknown; height?: unknown } | null;
  const ref = imageRef(args[0]);
  const w =
    ref?.width ?? (typeof source?.width === "number" ? source.width : 0);
  const h =
    ref?.height ?? (typeof source?.height === "number" ? source.height : 0);
  return { x: two[0], y: two[1], w, h };
}

/**
 * Every bitmap `calls` blitted, as axis-aligned boxes in device pixels.
 *
 * THE FRAME IS WALKED, CARRYING THE TRANSFORM AND THE SMOOTHING FLAG. Both are
 * ordinary context state: `save`/`restore` stack them together, the engine's own
 * frame preparation issues the letterbox fit as a `setTransform` the recorder
 * sees, and the build's renderer draws each sprite under a `translate` and a
 * quarter `rotate` inside a `save`. So the state in force at a call is recovered
 * exactly by replaying the operations the frame issued, from the state the frame
 * opened under.
 *
 * `smoothingAtOpen` and `matrixAtOpen` are the flag and the transform in force
 * when the FRAME OPENED rather than the canvas's own defaults, because both are
 * context state that survives every frame boundary: a build is free to set
 * `imageSmoothingEnabled` once when it starts and never again, and a fit issued
 * outside the frame is in force on every frame after it. Under this engine the
 * fit is re-issued inside every frame, so the opening transform is overridden
 * before the first blit; it is carried all the same, so the walk reads the same
 * way the engineless project's does. {@link Harness.frameBlits} reads both off
 * the real context before it runs the frame.
 *
 * The four corners of each destination rectangle are mapped through the transform
 * and the box is taken around them, so a sprite drawn under the quarter turns
 * `specs/assets.md` states still reports the square of the canvas it covered.
 */
export function blitsOf(
  calls: readonly DrawCall[],
  smoothingAtOpen = true,
  matrixAtOpen: Matrix = IDENTITY,
): Blit[] {
  const blits: Blit[] = [];
  const stack: { matrix: Matrix; smoothing: boolean }[] = [];
  let matrix: Matrix = matrixAtOpen;
  let smoothing = smoothingAtOpen;

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "imageSmoothingEnabled") {
        smoothing = call.value !== false;
      }
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push({ matrix, smoothing });
      continue;
    }
    if (method === "restore") {
      const held = stack.pop();
      matrix = held?.matrix ?? matrixAtOpen;
      smoothing = held?.smoothing ?? smoothingAtOpen;
      continue;
    }
    const moved = transformed(matrix, method, args);
    if (moved !== null) {
      matrix = moved;
      continue;
    }
    if (method !== "drawImage") continue;
    const box = destinationOf(args);
    if (box === null) continue;
    const corners = [
      applyMatrix(matrix, box.x, box.y),
      applyMatrix(matrix, box.x + box.w, box.y),
      applyMatrix(matrix, box.x, box.y + box.h),
      applyMatrix(matrix, box.x + box.w, box.y + box.h),
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    blits.push({
      id: sourceId(args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing,
      quarterTurns: quarterTurnsOf(matrix),
    });
  }
  return blits;
}

/** Where a blit's centre landed, in device pixels. */
export function blitCenter(blit: Blit): Point {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose centre landed inside cell `(col, row)`.
 *
 * A sprite covers one cell (`specs/assets.md`), so the cell a blit belongs to is
 * the one its centre falls in — which stays true under the quarter turns that
 * same file has a sprite drawn with, and under whatever fit the engine applied.
 */
export function blitsOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): Blit[] {
  const view = h.viewport();
  const half = (CELL * view.scale) / 2;
  const middle = cellCenter(col, row);
  const at = h.device(middle.x, middle.y);
  return blits.filter((blit) => {
    const centre = blitCenter(blit);
    return (
      Math.abs(centre.x - at.x) <= half && Math.abs(centre.y - at.y) <= half
    );
  });
}

/**
 * The blit that painted cell `(col, row)`, or `null` for a cell no blit landed
 * on.
 *
 * The LAST blit on the cell, for the same reason {@link spriteOnCell} takes it:
 * that is the one a player sees. A check that needs the whole stack has
 * {@link blitsOnCell}.
 */
export function blitOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): Blit | null {
  const on = blitsOnCell(h, blits, col, row);
  return on.length === 0 ? null : on[on.length - 1]!;
}

/**
 * The produced file painted on cell `(col, row)`, or `null` for a cell no blit
 * landed on.
 *
 * The LAST blit on the cell, because that is the one a player sees: a build that
 * paints a cell twice has shown the second.
 */
export function spriteOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): string | null {
  const found = blitsOnCell(h, blits, col, row);
  return found.length === 0 ? null : found[found.length - 1].id;
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

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/** The window a harness reports to the engine, and the clock it steps on. */
export interface HarnessOptions extends EngineHarnessOptions {
  /** The clock each frame takes its delta from. Defaults to {@link FRAME_HZ}. */
  clock?: Clock;
}

/**
 * How far a sweep may run, IN WHOLE TICKS.
 *
 * Coil's own, and deliberately not the package's `UntilOptions`. A tick of this
 * game is {@link FRAMES_PER_TICK} frames, and the package's sweep counts FRAMES
 * under both of its names — so a bound stated there would run this game an eighth
 * of the distance a suite asked for, silently, and a sweep that was meant to
 * reach a death would report that it never happened.
 */
export interface UntilOptions {
  maxTicks?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** WHOLE TICKS driven before the sample that ended the sweep. */
  ticks: number;
  snapshot: CoilSnapshot;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

/**
 * Which pointer a dispatched event comes from, and what it is holding.
 *
 * The engine reads `pointerType`, `pointerId`, `isPrimary`, `button` and
 * `buttons` off a pointer event and nothing else (the engine's input
 * documentation), so these are exactly the facts a check can vary. Every one has
 * a default describing an ordinary left mouse button, which is what a menu check
 * wants; `device: "touch"` is what makes the same helper drive a finger.
 */
export interface PointerOptions {
  /** Which kind of device drove it, carried as `pointerType`. */
  device?: PointerDevice;
  /** Which pointer, carried as `pointerId`. */
  id?: number;
  /** Whether this is the primary pointer. Defaults to true. */
  primary?: boolean;
  /** The button a press or a release names. Defaults to the primary one. */
  button?: PointerButton;
}

/** The three pointer events the engine listens for. */
type PointerEventType = "pointerdown" | "pointermove" | "pointerup";

/**
 * A `PointerEvent`-shaped event, carrying the seven fields the engine reads and
 * nothing else.
 *
 * COIL'S OWN, AND NOT THE PACKAGE'S `DevicePointerEvent`. The difference is the
 * button mask: the package's states `buttons: 1` on every move, which is a DRAG,
 * where this one reports the buttons genuinely held by that pointer id — so a
 * hover with nothing pressed carries `buttons: 0`, which is what a real mouse
 * sends and what `specs/ui.md`'s "a pointer arriving over an item selects it"
 * is stated about. A move that claimed a held button would take a different path
 * through the engine's chord tracking, and every pointer verdict in this project
 * was taken under the mask a real device reports.
 *
 * A shim rather than a real `PointerEvent`: this project runs on a canvas with no
 * document behind it, so there is no `PointerEvent` constructor to call and no
 * element to dispatch from. The engine narrows structurally, so an event carrying
 * those fields drives the pointer exactly as a player's does.
 */
class PointerShapedEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: PointerEventType,
    fields: {
      clientX: number;
      clientY: number;
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      button: number;
      buttons: number;
    },
  ) {
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
 * The browser's own numbering for `PointerEvent.button`, which the engine reads
 * a button's name out of. `-1` is the value a move carries: the field saying the
 * event is about position rather than about a button.
 */
const BUTTON_INDEX: Readonly<Record<PointerButton, number>> = {
  primary: 0,
  auxiliary: 1,
  secondary: 2,
  back: 3,
  forward: 4,
};

/** The bit each button occupies in the `PointerEvent.buttons` mask. */
const BUTTON_BIT: Readonly<Record<PointerButton, number>> = {
  primary: 1,
  secondary: 2,
  auxiliary: 4,
  back: 8,
  forward: 16,
};

/** The `buttons` mask a set of held buttons makes. */
function buttonMask(held: Iterable<PointerButton>): number {
  let mask = 0;
  for (const button of held) mask |= BUTTON_BIT[button];
  return mask;
}

/**
 * The client position a logical point sits at, which is what a dispatched
 * pointer event carries.
 *
 * The inverse of the conversion the engine documents: it takes a client
 * position, subtracts the surface's origin (`(0, 0)` here, because the harness
 * declares none), multiplies by the device pixel ratio, and maps it through the
 * inverse viewport. Going the other way is the viewport map followed by a
 * division by the ratio, so a check names a point in the units `menuItemRect`
 * reports and the game reads that same point back.
 */
function toClient(view: Viewport, dpr: number, x: number, y: number): Point {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
}

/** Everything this case's harness carries past the package's own contract. */
interface CoilModel {
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<CoilState>;

  /**
   * Whether the build has the cue `name` looping at this moment.
   *
   * The engine's cue bus carries the same reading, and the bus announces every
   * transition of it — `cue:looped` when a loop starts and `cue:stopped` when it
   * ends, each exactly once — so the set kept from those two events is that
   * reading rather than an approximation of it. What {@link watchCues} records is
   * the other thing: the moments a cue was ASKED for. A bed that was started and
   * never stopped shows one entry in the log and reads `true` here.
   */
  looping(name: string): boolean;

  /**
   * Press a key, run the one frame that delivers its edge, and release it.
   *
   * The engine discards an edge nothing consumed by the end of the frame it was
   * armed in, so a tap that ran no frame would never reach the game. The frame
   * runs BETWEEN the press and the release, which is the case's own order and
   * not the package's: `specs/controls.md` makes every action a press EDGE, and
   * a build that instead compares held state at the top of each frame — which is
   * equally conformant under the engine's input contract — sees a key that was
   * pressed and released before the frame ran as never having been held at all.
   */
  tap(code: string): Promise<void>;

  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<CoilSnapshot>;
  /** Drive a TICK at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: CoilSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Forget every call recorded so far, so the next frame's render stands alone. */
  clearCalls(): void;
  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;

  /**
   * Move the pointer to a logical point, with no button pressed.
   *
   * Every pointer method here dispatches a `PointerEvent`-shaped event at the
   * target the engine listens on and lets the ENGINE do the rest — the mapping
   * onto logical units, the contacts, the edges — so what a check drives is the
   * pipeline a player drives. The position is given in the same logical units
   * `menuItemRect` reports, and the harness converts it back to the client
   * position an event carries.
   */
  pointerMove(x: number, y: number, options?: PointerOptions): void;
  /** Press a button at a logical point, bringing the pointer into contact. */
  pointerDown(x: number, y: number, options?: PointerOptions): void;
  /** Release a button at a logical point, ending the contact it was holding. */
  pointerUp(x: number, y: number, options?: PointerOptions): void;
}

/**
 * Everything a check reads off one engine running one build.
 *
 * THREE OF THE PACKAGE'S MEMBERS ARE REPLACED RATHER THAN JOINED, and the two
 * that matter are replaced because this case's word for them means something
 * else. The package's `tick()` is its `frame()` under a second name — one
 * counter, two vocabularies — where Coil's `tick(ticks)` DRIVES whole ticks of
 * the simulation, each {@link FRAMES_PER_TICK} frames; and the package's
 * `until` counts its bound in frames under both of its names, where Coil's
 * counts it in ticks. Left joined, an intersection would resolve each call to
 * the package's member and a sweep asked for 400 ticks would run 400 frames.
 * `tap` is replaced only so the order on {@link CoilModel.tap} is the one a
 * check gets.
 */
export type Harness = Omit<
  EngineHarness<CoilSnapshot, CoilDriver, CoilEngine>,
  "tick" | "until" | "tap"
> &
  CoilModel;

/**
 * The package's engine machinery, bound to Coil on this engine.
 *
 * Where the four engines differ, each is answered here from what THIS engine is:
 *
 *  - `driver` is the apply-threaded strategy, over `surface.ts`'s `READINGS`. It
 *    forwards a reading's own arguments past the state, which is what makes
 *    `menuItemRect(index)` reach the surface with the index the check asked
 *    about rather than about item zero.
 *  - `toLogical` is left at the identity. There is no camera under this engine —
 *    the engine maps the stage onto the canvas and nothing else stands between.
 *  - `pointerPrecision` stays `"exact"`, so a raised pointer lands exactly where
 *    the caller asked rather than on the nearest device pixel. The pointer trio
 *    on {@link CoilModel} does not go through the kit's own `pointer` at all —
 *    see {@link PointerShapedEvent} — so this settles only the kit's member.
 */
const kit = createEngineCaseHarness<
  CoilSnapshot,
  CoilDriver,
  CoilEngine,
  CoilModel
>({
  slug: "coil",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  // The rate a second of simulated time is counted at, which for this project is
  // the FRAME rate rather than the tick rate: a tick is FRAMES_PER_TICK of these.
  tickHz: FRAME_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // BOTH CUE EVENTS, not the package's `cue:played` alone. `specs/ui.md` makes
  // `music` a bed that LOOPS under a round, and an engine announces a bed
  // starting as `cue:looped` — so a subscription to plays alone would read every
  // music point in this project as silence.
  cueEvents: ["cue:played", "cue:looped"],
  // The copy readings below place a run at its anchor, so each text call is
  // measured and the transform in force at it is recorded off the real context.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(FRAME_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<CoilState, CoilSurface>({
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
    applyDriver<DeepReadonly<CoilState>, CoilState, CoilDriver>(engine, raw, {
      readings: READINGS,
    }),
  snapshot: (debug) => debug.snapshot(),
  extend: (base, engine) => {
    // The names looping right now, tracked across the bus's own two
    // announcements. Subscribed here rather than in the kit because `cue:stopped`
    // is not one of the events the kit stamps: what it says is that a loop ENDED,
    // which is a transition rather than a firing.
    const loops = new Set<string>();
    engine.events.on("cue:looped", ({ cue }) => loops.add(cue));
    engine.events.on("cue:stopped", ({ cue }) => loops.delete(cue));

    /**
     * What each pointer id is holding, so a move dispatched mid-drag reports the
     * mask a real one would and a check never has to state it.
     */
    const heldButtons = new Map<number, Set<PointerButton>>();
    const heldBy = (id: number): Set<PointerButton> => {
      const existing = heldButtons.get(id);
      if (existing !== undefined) return existing;
      const created = new Set<PointerButton>();
      heldButtons.set(id, created);
      return created;
    };

    const raise = (
      type: PointerEventType,
      x: number,
      y: number,
      options: PointerOptions,
      button: PointerButton | null,
    ): void => {
      const id = options.id ?? 0;
      const at = toClient(engine.viewport(), base.shape.dpr, x, y);
      base.events.dispatchEvent(
        new PointerShapedEvent(type, {
          clientX: at.x,
          clientY: at.y,
          pointerId: id,
          pointerType: options.device ?? "mouse",
          isPrimary: options.primary ?? true,
          // A move is about position rather than about a button, which the field
          // says with -1.
          button: button === null ? -1 : BUTTON_INDEX[button],
          buttons: buttonMask(heldBy(id)),
        }),
      );
    };

    /** Clear the record, run one frame, and answer what that frame issued. */
    const oneFrame = async (): Promise<FrameDraw> => {
      base.calls.length = 0;
      // The flag and the transform in force when the frame OPENS, which is where
      // the walk over the frame's own operations starts. Read off the real
      // context rather than assumed, because both are context state a build may
      // have set once and left.
      const smoothing = base.ctx.imageSmoothingEnabled;
      const m = base.ctx.getTransform();
      const transform: Matrix = [m.a, m.b, m.c, m.d, m.e, m.f];
      await base.advance(1);
      const calls = [...base.calls];
      return { calls, blits: blitsOf(calls, smoothing, transform) };
    };

    return {
      get state() {
        return engine.state;
      },

      looping: (name: string) => loops.has(name),

      async tap(code: string) {
        base.hold(code);
        await base.advance(1);
        base.release(code);
      },

      async tick(ticks = 1) {
        await base.advance(tickFrames(ticks));
        return base.snapshot();
      },

      async until(
        predicate: (snapshot: CoilSnapshot) => boolean,
        options: UntilOptions = {},
      ) {
        const maxTicks = options.maxTicks ?? 240;
        let snapshot = base.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
        for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
          await base.advance(FRAMES_PER_TICK);
          snapshot = base.snapshot();
          if (predicate(snapshot)) return { hit: true, ticks, snapshot };
        }
        return { hit: false, ticks: maxTicks, snapshot };
      },

      clearCalls: () => {
        base.calls.length = 0;
      },
      frameDraw: () => oneFrame(),
      frameCalls: async () => (await oneFrame()).calls,
      frameBlits: async () => (await oneFrame()).blits,

      pointerMove: (x: number, y: number, options: PointerOptions = {}) => {
        raise("pointermove", x, y, options, null);
      },
      pointerDown: (x: number, y: number, options: PointerOptions = {}) => {
        const button = options.button ?? "primary";
        heldBy(options.id ?? 0).add(button);
        raise("pointerdown", x, y, options, button);
      },
      pointerUp: (x: number, y: number, options: PointerOptions = {}) => {
        const button = options.button ?? "primary";
        heldBy(options.id ?? 0).delete(button);
        raise("pointerup", x, y, options, button);
      },
    };
  },
});

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the touch layout — plus the clock and the surface metrics a headless run needs.
 * So one harness serves every build of this case, and everything else the build
 * decided lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  // The kit hands back its own contract joined with this case's; `Harness`
  // replaces the three members named above rather than joining them, and the two
  // shapes are otherwise the same object.
  return (await kit.createHarness(options)) as unknown as Harness;
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` requires one cue per event, played on the tick its event
// resolves, and names the four: `eat`, `combo-up`, `death`, and a looping
// `music`. Under this engine the build declares each by name and plays it by
// name, and the engine announces every play — so what a check reads is WHICH cue
// sounded, not merely that something did, and it reads it without a decoder.
//
// The produced `.wav` behind each cue really is loaded in this process: the host
// installed above fetches it and the `AudioContext` beside it decodes it, so a
// build that binds its cues from its own files gets its names bound and plays
// them. None of that is what a check here reads. Nothing sounds, the stand-in
// context is inert, and no sample ever leaves a buffer — what these checks read
// is the ask, by name, and the points that are about the FILES read their bytes
// off disk instead.
//
// A LOOP IS RECORDED AS WELL AS A PLAY. `specs/ui.md` makes `music` a bed that
// LOOPS under a round, and an engine announces a bed starting as `cue:looped`
// rather than as `cue:played` — so a case that subscribed the package's default
// alone would read every music point as silence.

/**
 * A cue the build played, stamped with the frame it sounded on.
 *
 * The package's, bound rather than restated: every engine publishes `cue:played`
 * SYNCHRONOUSLY from inside the play call, so the handler runs while the frame
 * that played it is still running and the stamp is exact rather than inferred.
 * It names the cue `cue` where this project's own spelling was `name`, and the
 * two readings below are the only place either word is written.
 */
export type { TimedCue };

/**
 * Record every cue the build plays from this call onward.
 *
 * A live array the kit pushes into, rather than a slice taken at the end: a check
 * reads it after the drive it is about, and what it holds is exactly the cues
 * that sounded during that drive and none of the ones that sounded while the
 * scene was being posed.
 */
export function watchCues(h: Harness): TimedCue[] {
  // The kit's collector, over the one member it reads: `Harness` replaces three
  // of the package's members (see its declaration), so it is not the package's
  // own contract even though it is the same object.
  return kit.watchCues(h as unknown as Parameters<typeof kit.watchCues>[0]);
}

/** Every recorded play of the cue `name`, in the order they sounded. */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((played) => played.cue === name);
}

/** Every recorded play that fell on frame `frame` of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

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
// Both are evidence, never a verdict: the scenario's own value comes straight
// back, a scenario that throws still leaves what it had recorded, a capture that
// closed no frames writes nothing, and outside a run the media directory is unset
// and the whole thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "eat", () => h.tick());
 * assertEqual(after.score, PELLET_POINTS);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("coil", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * it drew a pellet as, where the letterbox bars fell.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — a `frameDraw()` or an
 * `advance(1)` following the arrangement — and before the assertions, so a check
 * that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  // The kit's writer, over the one member it reads: `Harness` replaces three of
  // the package's members (see its declaration), so it is not the package's own
  // contract even though it is the same object.
  kit.captureStill(
    h as unknown as Parameters<typeof kit.captureStill>[0],
    outputId,
  );
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The colour rendered at the centre of cell `(col, row)`.
 *
 * The centre pixel itself rather than an average over a cluster, because a cell
 * is `CELL` (32) units across: its centre is sixteen units from the nearest
 * edge, far outside any anti-aliased rim, and a build's own ruling or glow at a
 * cell's border cannot reach it.
 */
export function sampleCell(h: Harness, col: number, row: number): Rgb {
  const middle = cellCenter(col, row);
  const [r, g, b] = h.pixel(middle.x, middle.y);
  return { r, g, b };
}

/** The colours at the centres of several cells, in the order they were named. */
export function sampleCells(h: Harness, cells: readonly Cell[]): Rgb[] {
  return cells.map((cell) => sampleCell(h, cell.col, cell.row));
}

/* -------------------------------------------------------------------------- */
/* The obstacle operations                                                    */
/* -------------------------------------------------------------------------- */

/** The two operations a mode that lays obstacle cells adds to the surface. */
export interface ObstacleSurface {
  clearObstacles(): void;
  addObstacle(col: number, row: number): void;
}

/** Whether the mode this build ships lays obstacle cells at all. */
export function laysObstacles(snapshot: CoilSnapshot): boolean {
  return snapshot.mode === "maze";
}

/** What each harness answered about its obstacle operations. */
const obstacleSurfaces = new WeakMap<object, ObstacleSurface | null>();

/**
 * The obstacle operations, or `null` under a mode that lays no obstacle cell.
 *
 * `specs/instrumentation.md` puts `clearObstacles` and `addObstacle` on the
 * surface of an obstacle-placing mode alone, so their absence is a fault only in
 * a build whose snapshot reports such a mode. This is the one moment the mode is
 * known, so it is where the requirement is decided — and it is decided by
 * assertion rather than by a `TypeError` several frames later.
 *
 * Answered once per harness and remembered, because a harness runs one build and
 * `specs/mode.md` gives that build one mode for the whole session.
 */
export function obstacleSurface(h: Harness): ObstacleSurface | null {
  const remembered = obstacleSurfaces.get(h);
  if (remembered !== undefined) return remembered;
  const surface = readObstacleSurface(h);
  obstacleSurfaces.set(h, surface);
  return surface;
}

function readObstacleSurface(h: Harness): ObstacleSurface | null {
  const snapshot = h.snapshot();
  if (!laysObstacles(snapshot)) return null;
  const driven = h.debug as unknown as Record<string, unknown>;
  const missing = OBSTACLE_OPS.filter((op) => typeof driven[op] !== "function");
  if (missing.length > 0) {
    failSurface(
      `the build reports the ${snapshot.mode} mode, which lays obstacle ` +
        `cells, but engine.debug carries no ${missing
          .map((op) => `${op}()`)
          .join(", ")}`,
    );
  }
  const surface = h.debug as unknown as ObstacleSurface;
  return {
    clearObstacles: () => surface.clearObstacles(),
    addObstacle: (col, row) => surface.addObstacle(col, row),
  };
}

/**
 * Take every obstacle cell off the board, under a mode that lays any.
 *
 * A no-op under a mode that lays none, so a scenario that wants an open interior
 * says so once and reads the same board under either build.
 */
export function clearObstacles(h: Harness): void {
  obstacleSurface(h)?.clearObstacles();
}

/* -------------------------------------------------------------------------- */
/* The per-faculty gates                                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/instrumentation.md` gives the snake's steering, its travel, and the
// pellet's respawn a switch each, precisely so a scenario can hold one faculty
// still while it watches another. Isolation reaches INSIDE the snake: a check
// about the turn buffer wants a chain that steers and does not move, and a check
// about the head's advance wants one that moves and does not steer. The three
// helpers below are those readings, named, so a check says which faculty it is
// holding rather than restating the switch.
//
// Each is on when the game is played and each is restored by a `reset`, so a
// scenario that names none of them runs the whole game.

/** Whether a steering request is taken into the buffer and applied at a tick. */
export function gateSteering(h: Harness, enabled: boolean): void {
  h.debug.setSnakeSteering(enabled);
}

/** Whether the head advances, collides, grows, and eats at a tick. */
export function gateTravel(h: Harness, enabled: boolean): void {
  h.debug.setSnakeTravel(enabled);
}

/** Whether an eaten pellet is replaced by the next one. */
export function gatePelletRespawn(h: Harness, enabled: boolean): void {
  h.debug.setPelletRespawn(enabled);
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic — one field per operation — so a scenario is several
// calls in a fixed order, and the order matters: an obstacle cannot be laid on a
// cell the snake holds, a pellet cannot be placed on a snake segment or an
// obstacle, and the screen is set last so the tick never runs over a
// half-arranged board. That order is written once, here.
//
// The rule the authoring guide states is that a validator poses an ISOLATED
// world: it clears every entity the requirement is not about and spawns back
// exactly what it is about, and it holds still the faculties the requirement
// does not exercise. {@link poseScene} is the one place all of that is spoken in
// a single breath.

/** A world to pose, one field per thing on the board or switch over it. */
export interface Scene {
  /**
   * The obstacle course: cleared outright, left as the mode lays it, or laid as
   * exactly these cells. Cleared by default — see {@link poseScene}.
   */
  obstacles?: readonly Cell[] | "cleared" | "course";
  /** The chain, head first. */
  snake?: readonly Cell[];
  /** The direction the snake travels in. */
  dir?: Dir;
  /** The live pellet, or `null` for a board with none. */
  pellet?: Cell | null;
  /** The cell the next spawn places the pellet on, posed for one spawn. */
  nextPellet?: Cell;
  score?: number;
  best?: number;
  /** The multiplier M. */
  combo?: number;
  /** Seconds left on the combo window; `0` is closed. */
  comboWindow?: number;
  /** Whether a steering request is taken and applied. On by default. */
  steering?: boolean;
  /** Whether the head advances and collides. On by default. */
  travel?: boolean;
  /** Whether an eaten pellet is replaced. On by default. */
  pelletRespawn?: boolean;
  /** The screen the world is left on. `playing` by default. */
  screen?: Screen;
  /** The highlighted item, on a screen that carries a menu. */
  menuIndex?: number;
}

/**
 * Reset the game and pose exactly the world `scene` describes, through the
 * surface's atomic operations alone.
 *
 * The reset first, so nothing a previous section left is inherited: the snapshot
 * a scene starts from is a fresh session, on the title, with the starting chain,
 * no pellet, and every switch on. Then, in this order and for the reasons above:
 * the obstacles, the chain, the direction, an emptied turn buffer, the pellet,
 * the posed spawn, the figures, the switches, and finally the screen.
 *
 * The turn buffer is emptied whether or not the scene names a direction, because
 * a posed world holds no steering request the scenario did not make.
 *
 * THE OBSTACLE COURSE IS CLEARED UNLESS THE SCENE ASKS FOR IT. A posed world
 * holds what the requirement is about and nothing else, and the course is
 * furniture almost no point is about: a chain a check lays down a column, or a
 * pellet it drops on a cell it chose, must read the same way under a mode that
 * lays a course and one that does not, or the same check decides two different
 * things in two variants. A point that IS about the course says
 * `obstacles: "course"` for the one the mode lays, or names its own cells. Under
 * a mode that lays none this changes nothing.
 *
 * Defaults to the `playing` screen, since that is the only screen a tick
 * resolves on and a scene exists to be ticked; a scenario about a menu names its
 * own.
 */
export function poseScene(h: Harness, scene: Scene = {}): CoilSnapshot {
  h.debug.reset();

  const obstacles = scene.obstacles ?? "cleared";
  if (obstacles !== "course") {
    const surface = obstacleSurface(h);
    if (surface === null) {
      // A mode that lays no obstacle cell has none to clear and no operation to
      // lay one with, and a scene asking for an empty course already has it.
      if (obstacles !== "cleared" && obstacles.length > 0) {
        return fail(
          "a build whose mode lays obstacle cells, since the scene places some",
          `the build reports the ${h.snapshot().mode} mode, which lays none`,
        );
      }
    } else {
      surface.clearObstacles();
      if (obstacles !== "cleared") {
        for (const cell of obstacles) surface.addObstacle(cell.col, cell.row);
      }
    }
  }

  if (scene.snake !== undefined) h.debug.setSnake(scene.snake);
  if (scene.dir !== undefined) h.debug.setDirection(scene.dir);
  h.debug.clearTurns();

  if (scene.pellet !== undefined) {
    if (scene.pellet === null) h.debug.clearPellet();
    else h.debug.setPellet(scene.pellet.col, scene.pellet.row);
  }
  if (scene.nextPellet !== undefined) {
    h.debug.setNextPellet(scene.nextPellet.col, scene.nextPellet.row);
  }

  if (scene.score !== undefined) h.debug.setScore(scene.score);
  if (scene.best !== undefined) h.debug.setBest(scene.best);
  if (scene.combo !== undefined) h.debug.setCombo(scene.combo);
  if (scene.comboWindow !== undefined) {
    h.debug.setComboWindow(scene.comboWindow);
  }

  if (scene.steering !== undefined) gateSteering(h, scene.steering);
  if (scene.travel !== undefined) gateTravel(h, scene.travel);
  if (scene.pelletRespawn !== undefined) {
    gatePelletRespawn(h, scene.pelletRespawn);
  }

  h.debug.setScreen(scene.screen ?? "playing");
  if (scene.menuIndex !== undefined) h.debug.setMenuIndex(scene.menuIndex);
  h.debug.reconcile();
  return h.snapshot();
}

/**
 * The head cell every posed scenario starts from, unless it names another.
 *
 * Row 8 is the row `specs/board.md` lays the starting chain along, and
 * `specs/mode.md` states that the obstacle course carries none of that row — so
 * a chain laid along it is clear of the board's furniture even in a scene that
 * keeps the course. Column 10 leaves a long runway to the right and room behind
 * for a chain to trail into.
 */
export const HOME_HEAD: Cell = { col: 10, row: 8 };

/** What a posed step left, and the cell the next tick will enter. */
export interface StepScene {
  snapshot: CoilSnapshot;
  head: Cell;
  dir: Dir;
  /** The cell the head advances into on the next tick. */
  next: Cell;
}

/** A posed chain: where its head is, which way it faces, and how long it is. */
export interface StepOptions extends Omit<Scene, "snake" | "dir"> {
  head?: Cell;
  dir?: Dir;
  length?: number;
  /**
   * Ticks of clear travel between the posed head and the moment the scenario is
   * about — the pellet for {@link arrangeEat}, the fatal cell for
   * {@link arrangeApproach}. One by default, which is the moment itself and no
   * run-up at all.
   *
   * A check whose `replay` output has to show the behaviour ARRIVING poses more
   * than one and ticks the difference off inside its recording.
   */
  runUp?: number;
}

/**
 * Pose an isolated chain and say which cell its next tick enters.
 *
 * The single most-used arrangement in this project: nearly every point about
 * movement, turning, growth and collision is "a snake here, facing this way, one
 * tick". What the board holds is the chain and nothing else — the pellet is
 * taken off it and, as {@link poseScene} explains, so is the obstacle course —
 * unless `options` puts something back.
 */
export function arrangeStep(h: Harness, options: StepOptions = {}): StepScene {
  const head = options.head ?? HOME_HEAD;
  const dir = options.dir ?? "right";
  const length = options.length ?? 3;
  const snapshot = poseScene(h, {
    pellet: null,
    ...options,
    snake: chainFrom(head, dir, length),
    dir,
  });
  return { snapshot, head, dir, next: ahead(head, dir) };
}

/** What a posed eat left: the chain, and the pellet the next tick eats. */
export interface EatScene extends StepScene {
  /** The cell the pellet was placed on, which is the head's next cell. */
  pellet: Cell;
}

/**
 * Pose a chain with the pellet one cell ahead of its head, so the next tick
 * eats.
 *
 * Respawn is off by default, because a check watching one eat should not then be
 * met by a pellet landing on a cell it did not choose —
 * `specs/instrumentation.md` gives the switch for exactly this. A check that is
 * ABOUT the respawn passes `pelletRespawn: true`.
 */
export function arrangeEat(h: Harness, options: StepOptions = {}): EatScene {
  const head = options.head ?? HOME_HEAD;
  const dir = options.dir ?? "right";
  const pellet = ahead(head, dir, options.runUp ?? 1);
  const step = arrangeStep(h, {
    pelletRespawn: false,
    ...options,
    head,
    dir,
    pellet,
  });
  return { ...step, pellet };
}

/**
 * Pose a chain whose head is `runUp` cells from `target`, facing it, so the tick
 * after `runUp - 1` ticks of clear travel enters it.
 *
 * `target` is the fatal cell a collision point is about — a wall cell, an
 * obstacle cell, or a segment of the snake's own body — and `dir` is the
 * direction it is approached from, defaulting to `right`. The head is placed one
 * `runUp` cells short of `target` along that direction — one by default, which
 * is the fatal tick itself — and the chain trails back behind it. The pellet is
 * off the board, so the tick that resolves is the collision alone.
 */
export function arrangeApproach(
  h: Harness,
  target: Cell,
  options: StepOptions = {},
): StepScene {
  const dir = options.dir ?? "right";
  return arrangeStep(h, {
    ...options,
    head: ahead(target, OPPOSITE[dir], options.runUp ?? 1),
    dir,
  });
}

/* -------------------------------------------------------------------------- */
/* Reaching a screen the way a player does                                    */
/* -------------------------------------------------------------------------- */
//
// A point about the menus has to press keys, because the menus are what it is
// about. A point about anything else reaches its screen through `setScreen` and
// never touches a menu — a build with a broken title and a working tick must
// fail the navigation points and pass the movement ones.

/** Reset to a clean title, with nothing posed on the board. */
export function openTitle(h: Harness): CoilSnapshot {
  h.debug.reset();
  h.debug.reconcile();
  return h.snapshot();
}

/**
 * Move the highlight to `index` by pressing `down`, and accept it.
 *
 * `specs/controls.md` moves the highlight one item per press and wraps at the
 * ends, and every screen a menu sits on arrives with `menuIndex` at `0`
 * (`specs/ui.md`), so `index` presses of `down` land on item `index`.
 */
export async function chooseItem(h: Harness, index: number): Promise<void> {
  for (let i = 0; i < index; i += 1) await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Start a round from the title the way a player does: `confirm` on the first
 * item, which `specs/ui.md` makes the mode's own entry.
 */
export async function startRoundWithKeys(h: Harness): Promise<CoilSnapshot> {
  openTitle(h);
  await chooseItem(h, 0);
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* The menus, where the build drew them                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives every menu-bearing screen a pointer and a touch contact as
// well as the keyboard, and deliberately leaves the LAYOUT to the build: what it
// fixes is that the build reports each item's hit region through `menuItemRect`
// (`specs/instrumentation.md`), and that a pointer over that region selects the
// item. So every helper below asks the build where it put the item and then
// drives the pointer there. Nothing here knows a menu coordinate, and a build
// that lays its menus out any way it likes passes.
//
// WHAT IS DRIVEN IS THE ENGINE'S OWN PIPELINE. The event is dispatched at the
// target the engine listens on and the engine maps it, raises the contacts and
// closes the edges — so what a check reads afterwards is the game's own input
// handling, which is the half `specs/ui.md` fixes.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * `menuItemRect` answers `null` on `"playing"`, which shows no menu, and for an
 * index the current menu has no item at, so a check that asked for an item it
 * expects to exist gets a failure naming the reading rather than a `TypeError` on
 * the next line.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  if (rect === null || rect === undefined) {
    fail(
      `menuItemRect(${index}) to report the hit region of item ${index} on the ` +
        "menu the current screen shows, in logical units " +
        "(specs/instrumentation.md)",
      rect,
    );
  }
  return rect;
}

/** The centre of item `index`'s hit region, in logical units. */
export function menuItemCenter(h: Harness, index: number): Point {
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that reads it.
 *
 * A move alone, with no button: `specs/ui.md` makes a pointer arriving over an
 * item's region select it, which is the hover a mouse does and the reason this is
 * separate from a click.
 */
export async function hoverMenuItem(h: Harness, index: number): Promise<Point> {
  const at = menuItemCenter(h, index);
  h.pointerMove(at.x, at.y);
  await h.advance(1);
  return at;
}

/**
 * Click item `index`: move onto it, press, release, and run the frame.
 *
 * Both edges fall inside the one region, which is what `specs/ui.md` requires of
 * a confirm, and a frame may carry both.
 */
export async function clickMenuItem(h: Harness, index: number): Promise<Point> {
  const at = menuItemCenter(h, index);
  h.pointerMove(at.x, at.y);
  h.pointerDown(at.x, at.y);
  h.pointerUp(at.x, at.y);
  await h.advance(1);
  return at;
}

/**
 * Land a touch contact inside item `index`'s region and LEAVE IT DOWN.
 *
 * No move in front of the landing, because a finger does not hover — which is why
 * `specs/ui.md` makes the landing itself select the item. Left down so a check
 * about selection reads what the landing alone did, with no lift to confirm on.
 */
export async function landOnMenuItem(
  h: Harness,
  index: number,
): Promise<Point> {
  const at = menuItemCenter(h, index);
  h.pointerDown(at.x, at.y, { device: "touch" });
  await h.advance(1);
  return at;
}

/** Land a touch contact inside item `index`'s region and lift it there. */
export async function tapMenuItem(h: Harness, index: number): Promise<Point> {
  const at = await landOnMenuItem(h, index);
  h.pointerUp(at.x, at.y, { device: "touch" });
  await h.advance(1);
  return at;
}

/**
 * Press the pointer on item `from`, travel onto item `to`, and release there.
 *
 * The ordinary affordance that lets a player slide off a control to cancel: two
 * edges in different regions confirm nothing (`specs/ui.md`). Driven over
 * separate frames so the press, the travel and the release are each read.
 */
export async function slideOffMenuItems(
  h: Harness,
  from: number,
  to: number,
  options: PointerOptions = {},
): Promise<void> {
  const start = menuItemCenter(h, from);
  const end = menuItemCenter(h, to);
  h.pointerDown(start.x, start.y, options);
  await h.advance(1);
  h.pointerMove(end.x, end.y, options);
  await h.advance(1);
  h.pointerUp(end.x, end.y, options);
  await h.advance(1);
}

/** {@link slideOffMenuItems} with a finger: a contact that lifts where it did not land. */
export function dragOffMenuItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  return slideOffMenuItems(h, from, to, { device: "touch" });
}

/* -------------------------------------------------------------------------- */
/* Filling the board                                                          */
/* -------------------------------------------------------------------------- */

/** What a board posed one eat short of full left behind. */
export interface FullBoardScene {
  snapshot: CoilSnapshot;
  /** The chain, one cell short of the whole interior. */
  chain: Cell[];
  /** The one free interior cell, holding the pellet. */
  pellet: Cell;
}

/**
 * Pose the board one eat short of full: the snake filling every interior cell
 * but one, and the pellet on that one, directly ahead of the head.
 *
 * The next tick eats it, grows the chain onto the last free cell, and finds no
 * valid cell for the pellet that should follow — which is the board-cleared
 * ending `specs/movement.md` states and `specs/board.md` defines the valid set
 * for.
 *
 * The obstacle course is cleared first, because a course laid across the
 * interior leaves no contiguous path through every remaining cell, and the chain
 * has to be one the game could have grown into. Clearing it also makes the
 * obstacle cells ordinary interior cells (`specs/instrumentation.md`), so the
 * valid set the ending turns on is the whole interior under either mode.
 */
export function arrangeFullBoard(h: Harness): FullBoardScene {
  h.debug.reset();
  clearObstacles(h);
  const path = serpentine();
  const pellet = path[0];
  const chain = path.slice(1);
  const head = chain[0];
  const facing = DIRECTIONS.find((dir) => sameCell(ahead(head, dir), pellet));
  h.debug.setSnake(chain);
  if (facing !== undefined) h.debug.setDirection(facing);
  h.debug.clearTurns();
  h.debug.setPellet(pellet.col, pellet.row);
  h.debug.setScreen("playing");
  h.debug.reconcile();
  return { snapshot: h.snapshot(), chain, pellet };
}
