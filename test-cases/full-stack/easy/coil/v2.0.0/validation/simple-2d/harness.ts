// Coil — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`), the
// engine's frame counter, the cue events it broadcast, the draw calls the render
// issued, and the pixels those calls left on the canvas. Nothing here fabricates
// an outcome: the scenario helpers below only ARRANGE the world through the
// debug surface, and the real `update` the build wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: `setSnake`
// poses a chain, the three driver switches hold one faculty still while another
// is watched, and `reset` gives everything back. Posing through it is how a
// scenario is reproducible, and it is the seam the case's specification
// documents. `surface.ts` is that specification as types, and it is the only
// description of the surface this harness reads: the build's own module for it
// is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`, and the
// engine holds the second element and returns it from `engine.debug`. Reading it
// back off the engine is the only way a surface reaches a check, so a build that
// returned no surface, or a surface missing an operation, fails the checks that
// reach the game through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setScore(120)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// engine's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// WHAT THE HARNESS OWNS THAT THE SURFACE MUST NOT. The surface is ATOMIC by
// design — one field per operation — so every compound sequence lives here:
// opening a round, reaching a screen, staging a scenario, and the ISOLATION
// helpers that clear the world and place back only what a requirement is about,
// together with the three per-faculty gates `specs/instrumentation.md` states.
// {@link poseScene} is where they are all spoken in one breath.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
  Image,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
  createEngine,
  type CapturedImage,
  type Clock,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type Engine,
  type Game,
  type PathSegment,
  type PointerButton,
  type PointerDevice,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
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

/** The case's surface, bound to the state type the build declared. */
export type CoilSurface = CoilDebugApi<CoilState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<CoilState, CoilSurface>` here and the engine
 * is parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
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
export function cellCenter(col: number, row: number): { x: number; y: number } {
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
/* Driving the surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state, ...args) => R` becomes `(...args) => R`: the
 * driver hands it `engine.state` and passes the rest through, which is what makes
 * an INDEXED reading like `menuItemRect(index)` callable. Anything else
 * (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>, ...args: infer A) => infer R
    ? (...args: A) => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 *
 * Optional members stay optional, so the mode-only `clearObstacles` is still
 * `h.debug.clearObstacles?.()` — though a check about the obstacle course
 * reaches it through {@link obstacleSurface} instead, which says what is missing.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type CoilDriver = Driver<CoilState, CoilSurface>;

/* -------------------------------------------------------------------------- */
/* Readings taken off one frame's render                                      */
/* -------------------------------------------------------------------------- */

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

/**
 * Where a call was issued, read off the real context at the moment of the call.
 *
 * The transform in force, so the position the call named can be mapped into
 * device pixels whatever `translate`/`rotate`/`scale` the build applied; whether
 * image smoothing was on, which is what `specs/assets.md` fixes for a blit; and,
 * for a run of text, its measured width and the alignment that places it about
 * its anchor.
 */
export interface CallGeometry {
  transform: Matrix;
  smoothing: boolean;
  width?: number;
  textAlign?: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; at?: CallGeometry }
  | { kind: "set"; property: string; value: unknown };

/**
 * One bitmap the build blitted.
 *
 * `id` is the source's identity: the path the bitmap's bytes were served from,
 * as the engine resolved it under the asset root — so `assets/snake/body.png` —
 * which means two blits carry the same one exactly when they painted the same
 * produced file. `""` names a source this harness never served, which is a
 * canvas or an image the build made for itself. The rectangle is in DEVICE pixels, mapped through the transform in
 * force at the call, and `x + w / 2, y + h / 2` is its centre under any transform
 * the build drew under — which is what makes a blit attributable to a cell even
 * when it was drawn under the quarter turns `specs/assets.md` has a sprite drawn
 * with.
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

/** A cue the build played, and the frame of the drive it played it on. */
export interface TimedCue {
  /** The frame it sounded on, as {@link Harness.frame} counts them. */
  frame: number;
  /** The engine's simulated time at that frame, in milliseconds. */
  t: number;
  /** The cue's name, as the build declared and played it. */
  name: string;
  /** Whether this was the start of a loop, which is what `music` is. */
  loop: boolean;
  /** The gain it sounded at. `0` while muted. */
  gain: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the build load every produced sprite and sound through
// the engine, which resolves each path under `assets/` relative to the page the
// build is served from and fetches it. This project runs in a Node process with
// no page, so nothing resolves that relative URL unless something here does: the
// two globals the loader reaches for are stood up over the workspace's own
// `assets/` directory, once, for the life of the process.
//
// That is the same kind of thing the harness's canvas, surface metrics and clock
// are — the HOST the engine runs on — and without it the build is asked to draw
// from art nobody gave it. Every produced file is stood up for every check this
// project runs: nothing here withholds a path, refuses a request, or offers a
// switch that leaves the art out.
//
// AUDIO IS THE ONE THING THIS CANNOT SERVE. `loadAudio` decodes through a Web
// Audio context and this host has none, so every cue's produced file fails to
// load here. That is a fact about this process rather than a requirement on the
// build: the cue bus still names the cue the build asked to play, so
// `cue:played` still answers WHICH one sounded, and the points that are about
// the FILES read their bytes off disk directly, which is where they live.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/** Matches a leading URI scheme, which names a location outside the workspace. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The produced file each served bitmap's bytes came from, by content digest. */
const servedPaths = new Map<string, string>();

/** The produced file each decoded bitmap came from. */
const bitmapPaths = new WeakMap<object, string>();

let hostServed = false;

/** The digest a served file and a decoded blob are matched on. */
function digest(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * Stand `fetch`, `createImageBitmap` and `ImageBitmap` up over the workspace,
 * once.
 *
 * Idempotent and never undone: a Node process has no page for a relative URL to
 * resolve against and no image decoder at all, so this is what the host lacks
 * rather than something a single check borrows. The wrapper delegates anything
 * carrying a scheme or a leading slash to whatever `fetch` was already there, so
 * nothing else in the process loses the one it had.
 */
function serveWorkspaceAssets(): void {
  if (hostServed) return;
  hostServed = true;
  const host = globalThis as unknown as Record<string, unknown>;
  const inherited = host.fetch as
    ((input: string, init?: unknown) => Promise<Response>) | undefined;

  host.fetch = async (input: unknown, init?: unknown): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (SCHEME.test(url) || url.startsWith("/")) {
      if (inherited === undefined) {
        throw new Error(`coil harness: this host cannot fetch ${url}`);
      }
      return inherited(url, init);
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(WORKSPACE, url));
    } catch {
      // The shape the engine's loader reads as "that file is missing", which is
      // what a path with nothing behind it means on a served page too.
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    servedPaths.set(digest(bytes), url);
    return new Response(new Uint8Array(bytes));
  };

  host.createImageBitmap ??= async (blob: Blob): Promise<unknown> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = await loadImage(Buffer.from(bytes));
    const path = servedPaths.get(digest(bytes));
    if (path !== undefined) bitmapPaths.set(image as object, path);
    return image;
  };

  // WHY A GLOBAL IS NAMED HERE, AND WHY DELETING IT SILENTLY BREAKS THE MEDIA.
  //
  // The engine's recorder captures a drawn bitmap's pixels into the replay so a
  // player can redraw it, and it decides what IS a bitmap by asking whether the
  // value is an instance of one of the host's own image classes, `ImageBitmap`
  // among them. A browser has that class; Node has no image type at all, which
  // is why `createImageBitmap` above had to be supplied, and what it hands back
  // is `@napi-rs/canvas`'s `Image`. With no `globalThis.ImageBitmap` to match,
  // every sprite a build blits records as `{ $opaque: "Image" }`, the replay
  // carries no image data, and a player skips the blit — so a clip of a game
  // drawn from produced sprites plays back with those sprites missing.
  //
  // Naming that class as this host's `ImageBitmap` is the whole fix: it is
  // literally what `createImageBitmap` returns here, so the recorder captures
  // each sprite once and the replay carries the art the build actually drew.
  // `??=` because a host that already has the real class keeps it, and nothing
  // in the engine or in a build READS this global — to both of them
  // `ImageBitmap` is a type — so the game runs exactly as it does without it.
  host.ImageBitmap ??= Image;
}

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
  return bitmapPaths.get(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to {@link FRAME_HZ}. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/** How far a sweep may run, in whole ticks. */
export interface UntilOptions {
  maxTicks?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks driven before the sample that ended the sweep. */
  ticks: number;
  snapshot: CoilSnapshot;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

export interface Harness {
  readonly engine: Engine<CoilState, CoilSurface>;
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<CoilState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
   */
  readonly debug: CoilDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that
   * picture exists is here.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render has made since the last clear. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

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

  /** Frames run since the engine started. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): CoilSnapshot;
  /** Run `frames` frames of the harness's clock, back to back. */
  advance(frames: number): Promise<void>;
  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<CoilSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: CoilSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game to the engine's own frame loop for `ms` of real time. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by {@link hold}. */
  release(code: string): void;
  /**
   * Press a key, run the one frame that delivers its edge, and release it.
   *
   * The engine discards an edge nothing consumed by the end of the frame it was
   * armed in, so a tap that ran no frame would never reach the game.
   * `specs/controls.md` makes every action a press EDGE, so one tap is one
   * action however long the key is nominally down.
   */
  tap(code: string): Promise<void>;

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
   * Every pointer method below dispatches a `PointerEvent`-shaped event at the
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

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the engine's listeners and release the canvas. */
  dispose(): void;
}

/** The extra cue sinks {@link watchCues} opened, per harness. */
const cueSinks = new WeakMap<Harness, TimedCue[][]>();

/** A `KeyboardEvent`-shaped event: the engine reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

function toDevice(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
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
 * A shim rather than a real `PointerEvent`, for the same reason {@link KeyEvent}
 * is a shim: this project runs on a canvas with no document behind it, so there
 * is no `PointerEvent` constructor to call and no element to dispatch from. The
 * engine narrows structurally, so an event carrying those fields drives the
 * pointer exactly as a player's does.
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
function toClient(
  view: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
}

/** The methods whose position only means something once the transform is applied. */
const PLACED_METHODS = ["drawImage", "fillText", "strokeText"];

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 *
 * The transform and the smoothing flag are read off the real context at the
 * moment of a PLACED call rather than replayed from the operations before it,
 * because the build is free to draw under any transform it likes — the renderer
 * of this game draws a sprite under a `translate` and a quarter `rotate` — and
 * the context itself is the authority on where that put it.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (PLACED_METHODS.includes(method)) {
          const m = object.getTransform();
          const at: CallGeometry = {
            transform: [m.a, m.b, m.c, m.d, m.e, m.f],
            smoothing: object.imageSmoothingEnabled,
          };
          if (method !== "drawImage" && typeof args[0] === "string") {
            at.width = object.measureText(args[0]).width;
            at.textAlign = object.textAlign;
          }
          call.at = at;
        }
        calls.push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, because the surface is not a closed
 * list — an obstacle-laying mode adds two operations — and a stub written
 * against the common surface would report a mode-only operation as merely absent
 * rather than as the consequence of the build's missing surface.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would replace
 * the verdict with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): CoilSurface {
  return new Proxy({} as CoilSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine
 * that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`
 * (`specs/instrumentation.md`), the engine keeps the second element, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * A build that returned no pair at all never gets this far: the engine rejects
 * `initialize` itself, and the rejection fails the suite's `beforeEach` with the
 * engine's own message. What IS decided here is a pair whose second element is
 * no surface, which is a fault in the build and not in this harness, so it must
 * not present as one. It is not thrown from here — every suite builds its
 * harness in a `beforeEach`, and a throw there would bury the real verdict under
 * the harness's own stack — and it is not swallowed either:
 * {@link missingSurface} fails, by assertion, at the moment a check first
 * reaches for an operation on it.
 */
function readDebugSurface(engine: Engine<CoilState, CoilSurface>): CoilSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as CoilSurface;
}

/**
 * The imperative reading of the raw surface, over the engine that holds the
 * state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing surface or a missing operation fails the check that needed it and
 * never the `beforeEach` that built the harness. A member that is not a function
 * (`version`, or an operation the build left out) comes back as it is, which is
 * what lets the obstacle helpers test for their operations by `typeof`.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is
 * run through `engine.apply`, so the engine stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * engine with a message naming the rule.
 */
function driveSurface(
  engine: Engine<CoilState, CoilSurface>,
  raw: CoilSurface,
): CoilDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as CoilDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<CoilState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as CoilState);
      };
    },
  });
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the touch
 * layout — plus the clock and the surface metrics a headless run needs. So one
 * harness serves every build of this case, and everything else the build decided
 * lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  serveWorkspaceAssets();

  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;

  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<CoilState, CoilSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(FRAME_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its opening sounds observable: construction runs no game code, so
  // nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: TimedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  const sinks: TimedCue[][] = [];
  // The names looping right now, tracked across the bus's own two announcements.
  const loops = new Set<string>();
  const noteCue =
    (loop: boolean) => (played: { cue: string; t: number; gain: number }) => {
      const timed: TimedCue = {
        frame: engine.frame().count,
        t: played.t,
        name: played.cue,
        loop,
        gain: played.gain,
      };
      if (loop) loops.add(played.cue);
      cues.push(timed);
      for (const sink of sinks) sink.push(timed);
    };
  engine.events.on("cue:played", noteCue(false));
  engine.events.on("cue:looped", noteCue(true));
  engine.events.on("cue:stopped", ({ cue }) => {
    loops.delete(cue);
  });

  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

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

  const pointerEvent = (
    type: PointerEventType,
    x: number,
    y: number,
    options: PointerOptions,
    button: PointerButton | null,
  ): void => {
    const id = options.id ?? 0;
    const at = toClient(engine.viewport(), dpr, x, y);
    keys.dispatchEvent(
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

  const pointerMove = (x: number, y: number, options: PointerOptions): void => {
    pointerEvent("pointermove", x, y, options, null);
  };

  const pointerDown = (x: number, y: number, options: PointerOptions): void => {
    const button = options.button ?? "primary";
    heldBy(options.id ?? 0).add(button);
    pointerEvent("pointerdown", x, y, options, button);
  };

  const pointerUp = (x: number, y: number, options: PointerOptions): void => {
    const button = options.button ?? "primary";
    heldBy(options.id ?? 0).delete(button);
    pointerEvent("pointerup", x, y, options, button);
  };

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,

    looping: (name) => loops.has(name),

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),

    async tick(ticks = 1) {
      await engine.advance(tickFrames(ticks));
      return debug.snapshot();
    },

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 240;
      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        await engine.advance(FRAMES_PER_TICK);
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((done) => setTimeout(done, ms));
      controller.abort();
      await running;
    },

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      await engine.advance(1);
      dispatch("keyup", code);
    },

    clearCalls: () => {
      calls.length = 0;
    },
    async frameDraw() {
      calls.length = 0;
      await engine.advance(1);
      return { calls: [...calls], blits: blitsOf(calls) };
    },
    async frameCalls() {
      calls.length = 0;
      await engine.advance(1);
      return [...calls];
    },
    async frameBlits() {
      calls.length = 0;
      await engine.advance(1);
      return blitsOf(calls);
    },

    pointerMove: (x, y, options = {}) => pointerMove(x, y, options),
    pointerDown: (x, y, options = {}) => pointerDown(x, y, options),
    pointerUp: (x, y, options = {}) => pointerUp(x, y, options),

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => engine.destroy(),
  };

  cueSinks.set(harness, sinks);
  return harness;
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/** Every argument list `method` was called with, in order. */
export function callsTo(
  calls: readonly DrawCall[],
  method: string,
): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

/** Every value `property` was set to, in order. */
export function setsOf(
  calls: readonly DrawCall[],
  property: string,
): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

/** A point mapped through a transform. */
function through(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

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
 * The quarter turns a transform carries the `+x` axis through, or `null` for a
 * transform that is not a whole number of quarter turns.
 *
 * Read off the LINEAR part alone — the sprite's `+x` axis lands on `(a, b)` —
 * so the translate that puts the sprite on its cell and the uniform scale of the
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
 * The destination rectangle of a `drawImage` call, in the space it was issued
 * in, or `null` for a call whose arguments are not one of the three forms.
 *
 * A two-argument placement takes its size from the source, which is why the
 * source's own dimensions are read: a build that blits a sprite at its natural
 * size names no size at all.
 */
function destinationOf(args: unknown[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const source = args[0];
  const numbers = args.slice(1);
  if (!numbers.every((value) => typeof value === "number")) return null;
  const at = numbers as number[];
  if (at.length === 8) {
    return { x: at[4], y: at[5], w: at[6], h: at[7] };
  }
  if (at.length === 4) {
    return { x: at[0], y: at[1], w: at[2], h: at[3] };
  }
  if (at.length === 2) {
    const size = source as { width?: unknown; height?: unknown } | null;
    const w = typeof size?.width === "number" ? size.width : 0;
    const h = typeof size?.height === "number" ? size.height : 0;
    return { x: at[0], y: at[1], w, h };
  }
  return null;
}

/**
 * Every bitmap the recorded calls blitted, as axis-aligned boxes in device
 * pixels.
 *
 * The four corners of each destination rectangle are mapped through the
 * transform in force at the call and the box is taken around them, so a sprite
 * drawn under the quarter turns `specs/assets.md` states still reports the
 * square of the canvas it covered.
 */
export function blitsOf(calls: readonly DrawCall[]): Blit[] {
  const blits: Blit[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.method !== "drawImage") continue;
    const at = call.at;
    if (at === undefined) continue;
    const box = destinationOf(call.args);
    if (box === null) continue;
    const corners = [
      through(at.transform, box.x, box.y),
      through(at.transform, box.x + box.w, box.y),
      through(at.transform, box.x, box.y + box.h),
      through(at.transform, box.x + box.w, box.y + box.h),
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    blits.push({
      id: sourceId(call.args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing: at.smoothing,
      quarterTurns: quarterTurnsOf(at.transform),
    });
  }
  return blits;
}

/** Where a blit's centre landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
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
  const at = toDevice(view, middle.x, middle.y);
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

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/** One run of text a frame drew, and where it drew it in device pixels. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /** The run's measured width under the font in force, in the call's own space. */
  width: number;
  /** The alignment that places the run about its anchor. */
  textAlign: string;
}

/**
 * Every run of text the frame drew, with its anchor in device pixels.
 *
 * The position a `fillText` names is only where the text landed once the
 * transform in force at that call is applied, and under this engine that
 * transform always carries the letterbox fit as well as anything the build added.
 * Both are already on the call, read off the real context at the moment it was
 * made, so nothing here has to replay a frame's transform stack.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.at === undefined) continue;
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const [text, x, y] = call.args;
    if (typeof text !== "string") continue;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const anchor = through(call.at.transform, x, y);
    draws.push({
      text,
      x: anchor.x,
      y: anchor.y,
      width: call.at.width ?? 0,
      textAlign: call.at.textAlign ?? "start",
    });
  }
  return draws;
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * combo bar asked for strictly more of these than the same frame with no
 * multiplier to show, whatever shape the build chose to draw it as.
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
 * Every point a frame's drawing calls named, in the space they were issued in.
 *
 * Where a render put its geometry is the direct reading of what it drew: the
 * coordinates inside the HUD band are the HUD, and the ones over the board are
 * the board. The leading pair of arguments is the position for every method
 * listed, except the curve calls, whose control points come first and whose
 * endpoint is the last pair. These are NOT mapped through the transform, so a
 * check that needs device pixels reads {@link textDraws} or {@link blitsOf}.
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
      method === "lineTo" ||
      method === "drawImage"
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
// The produced `.wav` behind each cue cannot be loaded in this process, because
// the engine decodes audio through a Web Audio context and there is none here.
// That is this host's limit and not the build's: the cue bus still announces the
// cue the build asked for, so what these checks read is unaffected, and the
// points that are about the FILES read their bytes off disk instead.

/**
 * Record every cue the build plays from this call onward.
 *
 * A live array the harness pushes into, rather than a slice taken at the end: a
 * check reads it after the drive it is about, and what it holds is exactly the
 * cues that sounded during that drive and none of the ones that sounded while
 * the scene was being posed.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  cueSinks.get(h)?.push(played);
  return played;
}

/** Every recorded play of the cue `name`, in the order they sounded. */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((cue) => cue.name === name);
}

/** Every recorded play that fell on frame `frame` of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

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

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

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
const obstacleSurfaces = new WeakMap<Harness, ObstacleSurface | null>();

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
  /** The seed `reset` lays the pellet generator with. */
  seed?: number;
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
 * the figures, the switches, and finally the screen.
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
  h.debug.reset(scene.seed === undefined ? undefined : { seed: scene.seed });

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

/** A logical point on the stage. */
export interface Point {
  x: number;
  y: number;
}

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
  return { snapshot: h.snapshot(), chain, pellet };
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that poses a chain with a pellet ahead of it and then runs the tick
//    records the eat; the pose costs nothing, and the reviewer is not asked to
//    scrub past a minute of arrangement to reach the second that decides the
//    point.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
//    Nothing here can turn a passing check into a failing one: a recording that
//    cannot be written is reported as an output that never turned up, which is a
//    fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario. The suite behaves identically
//    either way, so a check cannot pass in one place and fail in the other.

/**
 * The environment variable the runner names the media directory in.
 *
 * Unset is not an error: it is the normal state of a suite nobody is collecting
 * media from.
 */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/turning/reversal-discarded.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/<engine>/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * few hundred operations, so a section a check drives for half a minute of
 * game time runs to tens of megabytes — a file nobody can serve to a reviewer and
 * nobody wants in a run's artifacts. The cap is what makes `captureReplay` safe to
 * wrap ANY section in: an author arms the recorder around what the check is about
 * and never has to reason about how long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a tick resolving, an eat, a round played to its ending — are written whole.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 *
 * `extension` is the one the runner collects that OUTPUT KIND under — `json.gz`
 * for a recording (a JSON document stored gzipped: `.json` is what the bytes are
 * and `.gz` is how they are framed), `png` for a still. The suite and the runner
 * agree by both stating the same thing about what the kind is.
 */
function mediaDestination(outputId: string, extension: string): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/**
 * A value's JSON with object keys in a fixed order, as the key a table
 * deduplicates on.
 *
 * Two entries that mean the same thing have to serialize identically for a table
 * to hold one copy of each, and the key order inside an argument the build passed
 * is the build's own business rather than ours.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Add `entry` to a table if it is new, and answer where it lives. */
function intern<T>(table: T[], at: Map<string, number>, entry: T): number {
  const key = canonical(entry);
  const found = at.get(key);
  if (found !== undefined) return found;
  const index = table.length;
  table.push(entry);
  at.set(key, index);
  return index;
}

/**
 * `frames` re-expressed against tables holding only what those frames name.
 *
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW
 * WITH. The four tables in front of a recording are shared by every frame in it,
 * so carrying them over whole would put operations, states, gradients and images
 * in the file that no surviving frame asks for — dead weight in a document whose
 * whole point is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
 *
 * Exported for the suite beside this file: a recording carrying an own field
 * named `__proto__` is one the engine's recorder writes and this one has to
 * rewrite as a field rather than as a prototype, and no drawing the reference
 * implementation makes produces one.
 */
export function retable(
  recording: Recording,
  frames: readonly RecordedFrame[],
): Recording {
  const images: CapturedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: Resource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: DrawOp[] = [];
  const opAt = new Map<string, number>();
  const states: DrawState[] = [];
  const stateAt = new Map<string, number>();

  const takeImage = (source: number): number => {
    const found = imageAt.get(source);
    if (found !== undefined) return found;
    const index = images.length;
    images.push(recording.images[source]);
    imageAt.set(source, index);
    return index;
  };

  const takeResource = (source: number): number => {
    const found = resourceAt.get(source);
    if (found !== undefined) return found;
    const recipe = recording.resources[source];
    // A recipe's own arguments were encoded when the value was used, so they can
    // only name entries interned before it: rewriting one terminates and cannot
    // re-enter this resource.
    const rebuilt: Resource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: DrawValue): DrawValue => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, DrawValue>;
    if (typeof record.$img === "number") {
      return { $img: takeImage(record.$img) };
    }
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
    const rewritten: Record<string, DrawValue> = {};
    for (const [key, held] of Object.entries(record)) {
      // Defined rather than assigned: a build's own object may carry a field named
      // `__proto__`, and assigning that name reaches the prototype setter instead
      // of writing a field the document carries.
      Object.defineProperty(rewritten, key, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return rewritten;
  };

  const operation = (op: DrawOp): DrawOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: readonly PathSegment[]): PathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (source: number): number => {
    const state = recording.states[source];
    const properties: Record<string, DrawValue> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return intern(states, stateAt, {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      // A frame inherits the current path along with the clip: a canvas keeps its
      // path across a frame boundary, and applying a clip leaves the clip outline
      // current, so a state that stopped at the clip would leave a bare `fill`
      // among the frame's operations filling that outline.
      path: segments(state.path),
    });
  };

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: stateOf(frame.state),
      stack: frame.stack.map(stateOf),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is kept,
 * so the reviewer sees the entire section at a lower frame rate instead of its
 * first — or last — few seconds at the full one. That is the reading that matches
 * what these outputs are named for. A round is evidence that the snake grew
 * eat after eat, and the eats are spread across the whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its
 * own: a frame names the whole of the state it opened with and reaches everything
 * it draws with through tables the recording shares, so dropping the frames
 * between two kept ones cannot leave a frame undrawable. Each kept frame's
 * `deltaMs` is restated as the time since the frame kept before it, so the deltas
 * still sum to the section's elapsed time and a player pacing itself off them
 * runs at the speed the game really ran at. The frame `count` is left as the host
 * reported it, so a reader can see that frames were skipped rather than being
 * told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at — the eat, the collision, the ending — and it is the
 * one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many
 * frames and stops one stride short of the end: the last frame still has to come
 * in, and the cap is a ceiling rather than a target. It takes the place of the
 * final strided frame — the frame nearest it, so the swap opens the smallest gap
 * available anywhere in the section — and is measured from where that frame was
 * measured from, which is what keeps the kept deltas summing to the elapsed time.
 *
 * What survives is then re-expressed against tables of its own, because those
 * tables are shared by every frame the recorder kept and a dropped frame takes
 * the last reference to whatever only it drew with.
 */
function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
  const kept: RecordedFrame[] = [];
  // The moment the section started, so the first kept frame's delta is its own
  // rather than a step measured from nothing.
  let previousMs = frames[0].timeMs - frames[0].deltaMs;
  const keep = (frame: RecordedFrame): void => {
    kept.push({ ...frame, deltaMs: frame.timeMs - previousMs });
    previousMs = frame.timeMs;
  };

  for (let i = 0; i < frames.length; i += stride) keep(frames[i]);
  const last = frames[frames.length - 1];
  if (kept[kept.length - 1].count !== last.count) {
    if (kept.length >= MAX_REPLAY_FRAMES) {
      // The stride spent the whole budget on the way to a frame short of the end.
      // Drop the frame it stopped on, and put the moment back to the one before
      // it: a kept frame's restated delta is measured from exactly that moment, so
      // subtracting it recovers it, and the last frame's own delta then spans the
      // gap the two of them leave.
      const displaced = kept[kept.length - 1];
      kept.length -= 1;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }

  return retable(recording, kept);
}

/**
 * Write a recording out, reporting rather than raising anything that goes wrong.
 *
 * A capture that closed no frames writes nothing. There is no picture in it to
 * draw, and a file holding an empty frame list would be collected as an output
 * that turned up — the run would tell the reviewer there is a replay to watch and
 * the player would open on nothing. A declared output that never turned up is
 * already reported as absent, and that is the truthful reading of a section that
 * drew no frames.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers, index lists and field names repeated once per
 * frame, which is close to the shape gzip is best at: a real capture of this game
 * stores many times smaller compressed. That is what keeps a run's whole
 * set of recordings to a few megabytes. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it, and the
 * document inside is the same one.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem. The runner already reads
 * a declared output that never turned up as exactly that.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`coil: could not write ${destination}: ${String(error)}`);
  }
}

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
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return scenario();

  h.engine.startRecording();
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * it drew a pellet as, where the letterbox bars fell. A recording of a still
 * screen would be the same frame three hundred times over, and a reviewer looking
 * at a menu wants to look at the menu.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — a `frameDraw()` or an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op, and a still that cannot be written
 * is reported as an output that never turned up, which is a fact about the host
 * rather than about the build.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`coil: could not write ${destination}: ${String(error)}`);
  }
}
