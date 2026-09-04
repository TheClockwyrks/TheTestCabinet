// Facet — the shared validator harness, structured-2d. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the surface's `snapshot`),
// the engine's object model — the open world and its game state — the engine's
// frame counter, the events the engine broadcast (`cue:played`, `cue:looped`,
// `asset:failed`), and, for the appearance checks, the pixels on the canvas or
// the calls the 2D context received. Nothing here fabricates an outcome: the
// helpers only ARRANGE the game through the debug surface, and the real ticks
// the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build:
// `loadBoard(rows)` poses the written board exactly, `requestSwap` goes through
// the same acceptance path a player's swap takes, and `reset({ seed })` gives
// everything back. Posing through it is how a scenario is reproducible, and it
// is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. Directly. Under this engine the world is LIVE, so a
// pose is `h.debug.loadBoard(rows)` and it has already happened when the call
// returns, and a reading is `h.debug.snapshot()`. There is no driver in between,
// which is the one thing that differs from the `simple-2d` copy of this file,
// where state is held by value and each pose runs through `engine.apply`.
//
// POSES DO NOT ADVANCE. No helper here advances a frame implicitly except the
// nine that are named for it: `swapAndStep`, `advanceStep`, `resolveChain`,
// `swapAndResolve`, `frameCalls`, `frameText`, `tap`, `tapAction` and
// `warmAudio`. The pointer verbs are not among them — `press`, `moveTo` and
// `lift` ARM an event and return, and the frame that delivers it is the caller's
// own next `advance`, which is what lets a check put its frame boundary where
// the question is. The gesture helpers below are not among them either: a press,
// the moves that carry it and the release all take effect at their calls, so a
// whole move is posed without the game advancing at all.
// Facet runs in ONE level (specs/overview.md), so no pose is a level
// transition and none of them needs a frame to land — which is what keeps
// `simTime`, `stepTimer` and the refusal timer readable exactly as the specs
// state them. A check that needs the frame DRAWN calls `h.advance(1)` itself.
//
// EVERY FIGURE COMES FROM `./constants`, NEVER FROM `../src/constants`. The build
// is held to the specification, not to its own numbers; see that file's header.
// The only things imported from the build are `game` and `BACKGROUND`, its two
// named deliverables in `src/game.ts`, and they are taken BY NAME, one binding at
// a time: a two-name list is a list a reader can count, where a namespace binding
// would name the same module and hand this file everything in it.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  createEngine,
  type CapturedImage,
  type Clock,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@test-cabinet/structured-2d";
import { BACKGROUND as buildBackground, game as buildGame } from "../src/game";
import { fail } from "./assert";
import {
  cellCenter,
  parseRows,
  renderBoard,
  quietRowsWith,
  quietRowsWithEscape,
  targetCenter,
  type BoardRows,
  type CellRef,
  type PlacedToken,
  type TargetRect,
} from "./board";
import {
  BACKGROUND_FALLBACK,
  BINDINGS,
  DEFAULT_SEED,
  LAYOUT,
  MAX_CHAIN_STEPS,
  MAX_REPLAY_FRAMES,
  PATCH_HALF,
  STAGE_H,
  STAGE_W,
  SWAP_DRIVE_FRAMES,
  TICK_HZ,
  TICK_MS,
  TICK_S,
  type ActionName,
  type PointerDevice,
} from "./constants";
import { setAssetTransport } from "./dom-shim";
import type { FacetDebugApi, FacetSnapshot, Screen } from "./surface";

export { ConstantClock, JitterClock, SequenceClock };
export type { Clock, Viewport, World };

/* -------------------------------------------------------------------------- */
/* The build under test                                                       */
/* -------------------------------------------------------------------------- */

/** The case's surface, exactly as `surface.ts` specifies it. */
export type FacetSurface = FacetDebugApi;

/**
 * The state specs/state.md declares, as the CASE declares it.
 *
 * Written here rather than imported from `../src/game` on purpose. A build's own
 * `FacetState` is the build's; what a check reads it against is the
 * specification, and this is the specification. It is a view over the engine's
 * `GameState` — the world's state IS an instance of the build's class, and these
 * are the fields specs/state.md says that class carries.
 *
 * A check should prefer `snapshot()`, which is the specified reading. This exists
 * for the rare point that is about the state itself rather than about the view of
 * it, and for a reader who wants to see what `engine.world.state` holds.
 */
export type FacetState = GameState & {
  screen: string;
  menuIndex: number;
  board: { cols: number; rows: number; cells: unknown[] };
  phase: string;
  chainStep: number;
  swapTimer: number;
  stepTimer: number;
  score: number;
  level: number;
  levelScore: number;
  lastCleared: number;
  lastPoints: number;
  lastWaves: number;
  moveScore: number;
  bestMove: number;
  bestChain: number;
  selection: { col: number; row: number } | null;
  offer: { col: number; row: number } | null;
  refusal: { a: CellRef; b: CellRef; timer: number } | null;
  armedTarget: string | null;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  simTime: number;
  muted: boolean;
  rngState: number;
};

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<FacetSurface>` here and the engine is parameterized with
 * it. A surface that departs from the specification is caught where a check
 * reaches for the missing member, not by the build's own compiler.
 */
const game = buildGame as unknown as GameDefinition<FacetSurface>;

/**
 * The build's exported stage background (specs/overview.md).
 *
 * Guarded rather than taken as read: `BACKGROUND` is handed to the engine as the
 * color the canvas is cleared to, and a build that exported something other than
 * a color string would stand the game up on it. Nothing asserts this value, so a
 * build that got it wrong is failed by the checks that are about the picture and
 * not by every check in the project.
 */
const BACKGROUND =
  typeof buildBackground === "string" ? buildBackground : BACKGROUND_FALLBACK;

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/** Where a `fillText`/`strokeText` put its run, and how wide it measured. */
export interface TextGeometry {
  transform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  width: number;
  textAlign: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };

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

/**
 * Every string the frame drew: the `fillText` runs in call order, then the
 * `strokeText` runs in call order.
 *
 * The two channels are kept apart on purpose. A build that outlines its title
 * issues a `strokeText` and a `fillText` for each glyph, and a single list in
 * true call order would read `F F A A C C E E T T` — a run that spells nothing.
 * Listed by channel, each channel spells the copy on its own.
 */
export function drawnText(calls: readonly DrawCall[]): string[] {
  const drawn: string[] = [];
  for (const method of ["fillText", "strokeText"]) {
    for (const args of callsTo(calls, method)) {
      if (typeof args[0] === "string") drawn.push(args[0]);
    }
  }
  return drawn;
}

/**
 * Whether `wanted` is among the words a frame put on screen.
 *
 * specs/ui.md fixes the COPY — `FACET`, `PRESSURE FINDS THE FLAW`, `SCORE`,
 * `PLAY AGAIN` — and fixes nothing about how many draw calls a build spends on
 * it. All four of these are conformant renderings of the same screen, and this
 * reads all four the same way:
 *
 *   one call per line     `"FACET"`
 *   one call per word     `"HOW"`, `"TO"`, `"PLAY"`
 *   one call per glyph    `"F"`, `"A"`, `"C"`, `"E"`, `"T"`
 *   a decorated entry     `"> PLAY <"`, or `"SCORE 120"` for a check about
 *                         the label alone
 *
 * Four readings, tried from the most local to the most permissive, so a build
 * that drew the copy in ONE call is decided by that call alone: a piece that IS
 * the copy; a piece that CONTAINS it; the frame's whole run of text; and that
 * run with all whitespace taken out of both sides, which is the only reading
 * that finds a line a build drew one word at a time.
 *
 * What the last two readings buy is bounded, and the bound is the rule for
 * using this: a search over the joined run can find a phrase that spans two
 * adjacent draws, so this decides that copy IS on screen and NEVER that two
 * pieces of copy are separate. An item about two readouts asks about each of
 * them; an item that asserts copy is ABSENT asserts the absence of that one
 * string and pairs it with a frame that does show it, so an accidental join
 * shows up as the two frames agreeing rather than as a verdict.
 */
export function showsText(pieces: readonly string[], wanted: string): boolean {
  const needle = wanted.trim().toLowerCase();
  if (needle === "") return true;
  const lower = pieces.map((piece) => piece.toLowerCase());
  if (lower.some((piece) => piece.trim() === needle)) return true;
  if (lower.some((piece) => piece.includes(needle))) return true;
  const joined = lower.join("");
  if (joined.includes(needle)) return true;
  const bare = (value: string): string => value.replace(/\s+/gu, "");
  return bare(joined).includes(bare(needle));
}

/** Whether the frame's own draw calls put `wanted` on screen. */
export function drewText(calls: readonly DrawCall[], wanted: string): boolean {
  return showsText(drawnText(calls), wanted);
}

/** The geometry calls a frame made, by name. */
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
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (
          (method === "fillText" || method === "strokeText") &&
          typeof args[0] === "string"
        ) {
          const m = object.getTransform();
          call.text = {
            transform: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
            width: object.measureText(args[0]).width,
            textAlign: object.textAlign,
          };
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

/* -------------------------------------------------------------------------- */
/* Events the engine broadcasts                                               */
/* -------------------------------------------------------------------------- */

/**
 * One sound the build made, and the frame of the run it made it on.
 *
 * ONE type under all three engines, so a cue script reads the same text whichever
 * one ran. `cue` is `string | null` for that reason: the name IS observable here,
 * where the game asks the engine's bus for a cue by name and the bus announces
 * the play, and it is NOT observable under `none`, where specs/ui.md fixes the
 * names inside the build's own code and nothing on the page reports them. The
 * asymmetry is a documented VALUE rather than a difference of shape.
 */
export interface TimedCue {
  /** The cue's name, which IS observable under this engine. */
  cue: string | null;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** Zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
  /** Whether it was started as a LOOP — a music bed — rather than a one-shot. */
  loop: boolean;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Color and patches                                                          */
/* -------------------------------------------------------------------------- */

/** A sampled color, each channel 0-255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One device pixel, as `[r, g, b, a]`. */
export type Rgba = [number, number, number, number];

/** A square of device pixels read off the canvas, centered on a cell. */
export interface Patch {
  /** The half-size in LOGICAL units the patch was asked for. */
  half: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Euclidean distance between two colors, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** The mean color of a patch, or black when the patch holds no pixels. */
export function meanColor(patch: Patch): Rgb {
  const pixels = patch.width * patch.height;
  if (pixels === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    r += patch.data[at];
    g += patch.data[at + 1];
    b += patch.data[at + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

/**
 * The mean per-pixel Euclidean RGB distance between two patches, 0 to about 441.
 *
 * THE DISTINGUISHABILITY INSTRUMENT. Per-pixel rather than between the two mean
 * colors, because a build is entitled to tell two kinds apart by FORM — the same
 * hue, a different facet pattern — and two patches with identical means can still
 * differ in every pixel. A hue difference and a form difference both register
 * here, which is what makes this reading fair to a build whose look is not the
 * reference's. It says nothing about which colors were used, and no check may
 * ask it to.
 *
 * Two patches of different shapes are a fixture fault rather than a reading, and
 * a patch of no pixels at all measures no distance.
 */
export function patchDistance(a: Patch, b: Patch): number {
  if (a.width !== b.width || a.height !== b.height) {
    fail(
      `two patches of the same shape (${a.width}x${a.height})`,
      `${b.width}x${b.height}`,
    );
  }
  const pixels = a.width * a.height;
  if (pixels === 0) return 0;
  let total = 0;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    total += Math.hypot(
      a.data[at] - b.data[at],
      a.data[at + 1] - b.data[at + 1],
      a.data[at + 2] - b.data[at + 2],
    );
  }
  return total / pixels;
}

/* -------------------------------------------------------------------------- */
/* Options, results, and the Harness itself                                   */
/* -------------------------------------------------------------------------- */

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to `TICK_MS`. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to `STAGE_W`. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to `STAGE_H`. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed `reset` is posed with. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * Whether the build's own produced files are served. Defaults to `true`.
   *
   * `false` answers every asset request 404, for the one kind of point that is
   * about a build surviving assets that never arrive.
   */
  assets?: boolean;
  /**
   * The sub-path the build is served from, as though the page sat there.
   * Defaults to `"/"`.
   *
   * specs/assets.md has a build load every produced file PAGE-RELATIVE, so that
   * the same tree works wherever it is mounted. Serving from a sub-path is how
   * that is decided: a request written relative to the page still resolves, and
   * one written from the site root no longer does. Under this engine the loader
   * refuses a root-absolute path before it ever reaches a transport, so a
   * conformant build loads identically at any `basePath` — which is the reading
   * the point wants, arrived at through the same option under all three engines.
   */
  basePath?: string;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  maxFrames?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: FacetSnapshot;
}

/** What driving a chain to its end found. */
export interface SettleResult {
  /** Whether `phase` really reached `idle` inside the cap. */
  settled: boolean;
  /** Chain steps driven. */
  steps: number;
  /** Frames advanced. */
  frames: number;
  snapshot: FacetSnapshot;
}

export interface Harness {
  /**
   * The `Engine` this harness built over the build's `game`. ENGINE-ONLY.
   *
   * The object the frame loop, the event bus, the viewport and the recorder all
   * hang off. There is no counterpart under `none`, where the build owns its own
   * runtime and the whole of it lives in a page.
   */
  readonly engine: Engine<FacetSurface>;
  /**
   * The world currently open, read fresh on every access. STRUCTURED-2D ONLY.
   *
   * This engine alone has a world and a camera; `simple-2d` holds a single state
   * by value and `none` has neither.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. ENGINE-ONLY.
   *
   * Live here, because `engine.world.state` IS the build's own object; under
   * `simple-2d` the same member is a value copy. Under `none` the state never
   * leaves the page and `snapshot()` is the only reading.
   */
  readonly state: FacetState;
  /**
   * The game instance, the one framework object that outlives every level.
   * STRUCTURED-2D ONLY: this engine alone has a `GameInstance`.
   */
  readonly instance: GameInstance<FacetSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and called directly: every
   * pose acts on the live world at the moment of the call.
   */
  readonly debug: FacetSurface;
  /**
   * The real `@napi-rs/canvas` 2D context, for `getImageData`. ENGINE-ONLY.
   *
   * Draw calls reach it too, through the recorder in front of it. Under `none`
   * the pixels live in the page and are read through an evaluation, so there is
   * no context to hold.
   */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   * ENGINE-ONLY, for the same reason as {@link Harness.ctx}: `toBuffer` is
   * called on it directly.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every one-shot cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every looping cue the build started, oldest first: the two music beds. */
  readonly loops: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];
  /**
   * Why the build's surface cannot be driven, or `null` when nothing is wrong.
   *
   * Set when `engine.debug` holds something that is not an object, or when the
   * object it holds carries no `reset`. A check reports the same fault by the
   * same name under all three engines; what differs is only where the surface was
   * looked for.
   */
  readonly surfaceFault: string | null;
  /**
   * Everything the build logged to `console.error`, or threw out of a frame,
   * oldest first.
   *
   * So a check can say the build FAULTED rather than merely produced a wrong
   * number.
   */
  readonly pageErrors: string[];
  /**
   * Every asset request that failed, as `<reason> <path>`, oldest first.
   *
   * The engine reports a refused path, a bad status and a failed decode alike
   * through `asset:failed`, so this is the same reading `none` takes from the
   * page's own responses.
   */
  readonly failedRequests: string[];
  /**
   * EVERY path the build's loader asked for, in order — not only the failures.
   *
   * What an item about where a build fetches from reads: that nothing left the
   * build's own tree, that the produced systems were asked for at all, and that
   * every path was written relative to the page.
   */
  readonly requests: string[];

  /** The frame counter, 1-based, as `engine.frame().count` reports it. */
  frame(): number;
  /** The frame loop's accumulated simulated time, in milliseconds. */
  timeMs(): number;
  /** A fresh read of the game through the case's `snapshot`. */
  snapshot(): FacetSnapshot;
  /** The board the build holds, in the notation of specs/board.md. */
  board(): string[];

  /** Run `frames` frames back to back, at the harness clock's delta. */
  advance(frames: number): Promise<void>;
  /**
   * Run `seconds` of game time as `frames` equal frames.
   *
   * The only way to exercise "an interval of game time reaches the same state
   * however it was divided into frames" (specs/instrumentation.md), which is
   * what the `delta-time-independent` point is about.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FacetSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The engine closes the input frame after the frame renders and an edge is
   * consumed once, so a tap between frames arms the edge for exactly the next
   * frame — which this runs.
   */
  tap(code: string): Promise<void>;
  /**
   * Fire one registered ACTION through the real input path — the level a review
   * item is actually written at ("fire the `up` action").
   *
   * It taps the action's FIRST binding in `BINDINGS`. specs/controls.md fixes
   * that whole table for a build of every engine, so all six actions can be
   * pressed here whatever the build was stood up on, and the alternate key
   * listed beside an action is there for a check that wants to prove the second
   * key fires it as well.
   */
  tapAction(action: ActionName): Promise<void>;

  /**
   * Press a REAL pointer at a LOGICAL stage point — the same `cellCenter(col,
   * row)` a surface pose takes.
   *
   * The other path from `debug.pointerDown`, and both exist. A point about the
   * press RULES poses through the surface, which specs/instrumentation.md says
   * takes effect at the call and needs no frame. A point about what the press
   * SOUNDS must come through here, because specs/ui.md plays a cue from a FRAME
   * and never from a pose of the debug surface, so a build is entitled to raise
   * no cue for a posed press.
   *
   * It arms the event and returns; the frame that delivers it is the caller's
   * next `advance`.
   */
  press(x: number, y: number): void;
  /**
   * Move the real pointer to a logical stage point; while it is held down that
   * is a DRAG.
   *
   * Every intermediate `moveTo` before the next `advance` becomes its own
   * `PointerSample`, which is what specs/controls.md requires of this engine — a
   * drag that crossed several cells between two frames arrives as every position
   * it visited rather than as the last one alone.
   */
  moveTo(x: number, y: number): void;
  /** Lift the real pointer at its last position, ending the drag. */
  lift(): void;
  /**
   * Where a logical stage point sits in the CLIENT/CSS coordinates a pointer
   * event carries — the inverse of the mapping a runtime applies to an incoming
   * event.
   *
   * The one conversion {@link Harness.press} and {@link Harness.moveTo} go
   * through, and what keeps them correct at a `dpr` other than 1.
   */
  client(x: number, y: number): { x: number; y: number };

  /** Clear the call log, run one frame, and hand back what that frame drew. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every string one frame drew. */
  frameText(): Promise<string[]>;
  /**
   * Reflect over the surface WITHOUT invoking it: the `typeof` of each name.
   *
   * `instrumentation/debug-api` is one script under all three engines and needs
   * one spelling. A `typeof` and nothing more, so the version's VALUE is not
   * reported here: the specification puts that value both on the surface, read
   * with {@link Harness.debugVersion}, and in the snapshot, read as
   * `snapshot().version`.
   */
  probe(names: readonly string[]): Promise<Record<string, string>>;
  /**
   * The `version` the surface itself carries, as a VALUE.
   *
   * `specs/instrumentation.md` puts the version in two places — on the surface
   * ("carries `version` … a plain number") and in the snapshot — so
   * `instrumentation/debug-api` reads both, and this is the surface half. One
   * spelling under all three engines: {@link Harness.probe} reports only the
   * `typeof` of a name, and the surface's own members are not otherwise
   * reachable as values under every engine.
   */
  debugVersion(): Promise<number>;

  /** The engine's current logical-to-device fit. */
  viewport(): Viewport;
  /** Where a LOGICAL stage point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * The same, for a point in WORLD units, through the world's camera first.
   * STRUCTURED-2D ONLY.
   *
   * Kept apart from {@link Harness.device} rather than folded into it: this
   * engine alone has a camera, `device` maps a LOGICAL stage point because
   * specs/board.md fixes cell centers on the stage, and collapsing the two would
   * silently apply a camera to a stage figure.
   */
  deviceFromWorld(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical stage point. */
  pixel(x: number, y: number): Rgba;
  /** The device-pixel box centered on a cell's center. */
  patch(col: number, row: number, half?: number): Patch;

  /**
   * Give the build whatever it needs before it may make a sound.
   *
   * A NO-OP under this engine, and the name still has to exist. Under `none` it
   * is a real, browser-trusted gesture, because specs/ui.md has audio start only
   * after the player has interacted with the page; here the bus is the engine's
   * and nothing gates it. Every audio item opens with "Arm audio", and the three
   * scripts must read the same.
   */
  armAudio(): Promise<void>;
  /**
   * Open the audio and wait, in REAL time, until a sound has actually gone out;
   * answer whether anything was ever heard.
   *
   * specs/assets.md has a build DECODE its produced `.wav`s asynchronously, so a
   * conformant build's first frames are silent and a cue check that read the very
   * first event would be reading the decoder. This waits for the decode instead
   * of hanging on it, and answers `false` so a check can say the build made no
   * sound at all.
   *
   * It DRIVES FRAMES. Call it while arranging, and read `frame()` after.
   */
  warmAudio(): Promise<boolean>;
  /**
   * Let `ms` of REAL time pass while the game stands still.
   *
   * For work a build does OFF the frame loop — decoding a sound, resolving a
   * fetch, decoding an image. Never for something the simulation does; that is
   * `advance`.
   */
  settle(ms: number): Promise<void>;

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
export const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * Fail the running check on `fault` — this harness's account of what is wrong
 * with the build's surface — paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
export function missingSurface(reason: string): FacetSurface {
  return new Proxy({} as FacetSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off the
 * engine that holds it.
 *
 * Deliberately a READ and never a construction. The surface is the build's
 * deliverable: its instance's `initialize` returns it, the engine keeps that same
 * object, and `engine.debug` is the only way it reaches a check.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 *  - It is NOT thrown from here. Every suite builds its harness in a
 *    `beforeEach`, so a throw at this point would fail the hook and bury the real
 *    verdict under the harness's own stack.
 *  - It is NOT swallowed either. {@link missingSurface} stands in and fails, by
 *    assertion, the moment a check first reaches for an operation.
 *
 * A surface that IS an object but is missing an operation is handed back
 * UNCHANGED, so `instrumentation/debug-api` can sweep it honestly and see which
 * of `REQUIRED_OPS` is absent. Wrapping it would fabricate the very members that
 * point exists to look for.
 */
export function readDebugSurface(engine: Engine<FacetSurface>): FacetSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as FacetSurface;
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The suite's clock: the caller's, with a queue of exact deltas in front of it.
 *
 * `advanceSeconds(s, n)` pushes `n` deltas of `s * 1000 / n` and advances `n`
 * frames, so one API covers both "n frames at the suite's tick" and "this second
 * of game time, in this many frames" under every engine. When the queue is empty
 * the base clock answers, so a check that set up a `SequenceClock` or a
 * `JitterClock` keeps it.
 */
export class HarnessClock implements Clock {
  private readonly base: Clock;
  private readonly queued: number[] = [];

  constructor(base: Clock) {
    this.base = base;
  }

  /** Queue `count` frames of exactly `deltaMs` each. */
  queue(deltaMs: number, count: number): void {
    for (let i = 0; i < count; i += 1) this.queued.push(deltaMs);
  }

  delta(nowMs: number): number | null {
    const next = this.queued.shift();
    if (next !== undefined) return next;
    return this.base.delta(nowMs);
  }
}

/** The seconds `frames` frames of the suite's own clock cover. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

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

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY` and
 * `isPrimary`, and maps the position through the live fit itself.
 *
 * A plain `Event` rather than a real `PointerEvent`, which Node does not have.
 * The engine narrows an event STRUCTURALLY on its client position, precisely so
 * that an event from any realm drives the pointer — see
 * `packages/structured-2d/src/input.ts`, `InputSystem.position`.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/**
 * A logical stage point in the CLIENT/CSS coordinates a pointer event carries.
 *
 * `(x * view.scale + view.offsetX) / dpr`, the inverse of the mapping a runtime
 * applies to an incoming event, and the one conversion the pointer verbs go
 * through. The fit is stated in DEVICE pixels and a pointer event carries CSS
 * pixels, so dividing by `dpr` is what keeps a press correct on a surface whose
 * backing store is denser than its layout. At the default shape the two are the
 * same number; a `dpr` of zero or less is no density at all and reads as 1.
 */
function toClient(
  view: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const ratio = dpr > 0 ? dpr : 1;
  return {
    x: (x * view.scale + view.offsetX) / ratio,
    y: (y * view.scale + view.offsetY) / ratio,
  };
}

/**
 * The sub-path a build is served from, with the one leading and one trailing
 * slash the request resolver assumes.
 */
function normalizeBase(basePath: string): string {
  const trimmed = basePath.replace(/^\/+/u, "").replace(/\/+$/u, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * The path below the served tree a request names, or `null` when the request
 * leaves the page's own sub-path.
 *
 * A page-relative request (`assets/gems/ruby.png`) names a file below wherever
 * the page is mounted, so it resolves at every `basePath`. A root-absolute one
 * names a place on the site, so it resolves only when the page is mounted there
 * — which is the whole of what the page-relative point asks.
 */
function servedPath(basePath: string, asked: string): string | null {
  let path = asked;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu.exec(path);
  if (scheme !== null) path = path.slice(scheme[0].length);
  path = path.split("?")[0].split("#")[0];
  if (path.startsWith("/")) {
    if (!path.startsWith(basePath)) return null;
    return path.slice(basePath.length);
  }
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}

/**
 * Rounds of {@link Harness.warmAudio}, and the real time each one waits.
 *
 * NOT specification figures. specs/assets.md fixes only that a produced sound is
 * decoded asynchronously, never how long that takes, so these are the suite's own
 * patience: sixteen rounds of 25 ms is 0.4 s of real time, far longer than a
 * handful of small `.wav`s take to decode off disk, and bounded so a build that
 * makes no sound at all is reported rather than waited on.
 */
const WARM_ROUNDS = 16;
const WARM_ROUND_MS = 25;

/* -------------------------------------------------------------------------- */
/* createHarness                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes
 * — the design size, the build's exported `BACKGROUND`, and the touch layout — so
 * one harness serves every build of this case. Everything else the build decided
 * lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const basePath = normalizeBase(options.basePath ?? "/");
  const serveAssets = options.assets !== false;

  // EVERY request the build makes passes through here, which is what makes
  // `requests` the whole record rather than only what failed. The transport
  // underneath is the disk fetch `setup.ts` installed; this wrapper decides only
  // which paths reach it, and under which mounted sub-path.
  //
  // A harness asked for no assets answers 404 itself — the status a static
  // server gives for a file that is not there — and ALSO turns the shared
  // transport off, so a build holding a `fetch` it captured before this harness
  // existed is refused by the same option. Both are put back on `dispose`.
  const requests: string[] = [];
  const previousFetch = globalThis.fetch;
  const transport = previousFetch.bind(globalThis) as (
    input: unknown,
    init?: unknown,
  ) => Promise<Response>;
  if (!serveAssets) setAssetTransport(false);
  (globalThis as unknown as Record<string, unknown>).fetch = (
    input: unknown,
    init?: unknown,
  ): Promise<Response> => {
    const asked = String(input);
    requests.push(asked);
    const served = serveAssets ? servedPath(basePath, asked) : null;
    if (served === null) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return transport(served, init);
  };

  // Everything the build writes to `console.error` while this harness is alive.
  // Installed BEFORE the engine is built, so a fault raised during the build's
  // own loading is recorded too. The real console still receives every line:
  // suppressing a build's own diagnostics would take from a reviewer the very
  // sentence that explains a verdict.
  const pageErrors: string[] = [];
  const previousConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    pageErrors.push(args.map((value) => String(value)).join(" "));
    previousConsoleError(...args);
  };

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

  const events = new EventTarget();
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const clock = new HarnessClock(options.clock ?? new ConstantClock(TICK_MS));

  const engine = createEngine<FacetSurface>({
    canvas: element,
    // The logical design size from specs/overview.md, exactly as src/main.ts
    // hands it.
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock,
    surface: metrics,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const failedRequests: string[] = [];
  const cues: TimedCue[] = [];
  const loops: TimedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
    failedRequests.push(`${reason} ${path}`);
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain, frame: engine.frame().count, loop: false });
  });
  engine.events.on("cue:looped", ({ cue, t, gain }) => {
    loops.push({ cue, t, gain, frame: engine.frame().count, loop: true });
  });

  // A build whose `initialize` THROWS is a build with no surface, and that is a
  // verdict about the build rather than a broken harness — so it is recorded and
  // this factory still returns. Nothing below is reached through the missing
  // instance: every check reads the game through `debug`, which stands in.
  let started: GameInstance<FacetSurface> | undefined;
  let surfaceFault: string | null = null;
  try {
    started = await engine.initialize();
  } catch (error) {
    surfaceFault = `src/game.ts's instance threw from initialize: ${String(error)}`;
    pageErrors.push(String(error));
  }
  const instance = started as GameInstance<FacetSurface>;
  const debug = readDebugSurface(engine);

  // Read ONCE, after `initialize`, because that is the moment the build has
  // returned whatever it is going to return. It is recorded rather than thrown:
  // a fault belongs on the checks that reach through the surface, never on every
  // suite's `beforeEach`.
  const rawSurface: unknown = engine.debug;
  if (surfaceFault === null) {
    if (typeof rawSurface !== "object" || rawSurface === null) {
      surfaceFault =
        `engine.debug holds ` +
        `${rawSurface === null ? "null" : typeof rawSurface}, not an object`;
    } else if (
      typeof (rawSurface as Record<string, unknown>).reset !== "function"
    ) {
      surfaceFault = "the surface on engine.debug carries no reset operation";
    }
  }

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  /** Where the last real pointer event was, so a release needs no position. */
  let lastPointer = { x: 0, y: 0 };
  const point = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    lastPointer = { x, y };
    const at = toClient(engine.viewport(), dpr, x, y);
    events.dispatchEvent(new PointerEvt(type, at.x, at.y));
  };

  // Every frame this harness drives goes through here, so an error the build
  // throws out of its own update is RECORDED on `pageErrors` before it travels
  // on unchanged to fail the check that drove the frame.
  const step = async (frames: number): Promise<void> => {
    try {
      await engine.advance(frames);
    } catch (error) {
      pageErrors.push(String(error));
      throw error;
    }
  };

  // Posed here so every check opens on the same, seeded, title-screen state
  // (specs/instrumentation.md). GUARDED: a build that returned no surface, or one
  // whose `reset` is missing, must fail the checks that reach through the surface
  // rather than every suite's `beforeEach`.
  if (surfaceFault === null) {
    try {
      debug.reset({ seed: options.seed ?? DEFAULT_SEED });
    } catch {
      // A `reset` that throws is the build's fault and belongs to the point about
      // `reset`, not to every other suite's setup.
    }
  }

  const toDevice = (
    x: number,
    y: number,
    throughCamera: boolean,
  ): { x: number; y: number } => {
    const view = engine.viewport();
    const point = throughCamera
      ? engine.world.camera.worldToLogical({ x, y })
      : { x, y };
    return {
      x: Math.round(view.offsetX + point.x * view.scale),
      y: Math.round(view.offsetY + point.y * view.scale),
    };
  };

  const harness: Harness = {
    engine,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state as FacetState;
    },
    instance,
    debug,
    ctx,
    canvas,
    calls,
    cues,
    loops,
    assetFailures,
    surfaceFault,
    pageErrors,
    failedRequests,
    requests,

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,
    snapshot: () => debug.snapshot(),
    board: () => renderBoard(debug.snapshot()),

    advance: (frames) => step(frames),

    async advanceSeconds(span, frames = 1) {
      // A fixture error fails as one, the way `loadBoard` already refuses a
      // malformed row: a count below one, or a fractional count, is a mistake in
      // the check, and repairing it silently would run a drive nobody asked for.
      if (!Number.isInteger(frames) || frames < 1) {
        fail(
          "advanceSeconds to be given a whole number of frames, at least 1",
          frames,
        );
      }
      clock.queue((span * 1000) / frames, frames);
      await step(frames);
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const run = Math.min(poll, maxFrames - frames);
        await step(run);
        frames += run;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
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
    // Down, up, THEN one frame. The engine arms an edge that survives to the
    // next frame and drops one nothing consumed, so a tap delivered this way is
    // news for exactly the frame that follows it. Under `none` the order is the
    // other way round — down, one frame, up — because a build there is entitled
    // to compare held state between frames, and a press released before any
    // frame ran would be invisible to it. Same meaning, two mechanisms, each one
    // written down where it lives rather than left to look accidental.
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await step(1);
    },
    async tapAction(action) {
      await harness.tap(BINDINGS[action][0]);
    },

    client: (x, y) => toClient(engine.viewport(), dpr, x, y),
    press: (x, y) => point("pointerdown", x, y),
    moveTo: (x, y) => point("pointermove", x, y),
    lift: () => point("pointerup", lastPointer.x, lastPointer.y),

    async frameCalls() {
      calls.length = 0;
      await step(1);
      return [...calls];
    },
    async frameText() {
      return drawnText(await harness.frameCalls());
    },
    probe(names) {
      const reflected: Record<string, string> = {};
      const raw =
        typeof rawSurface === "object" && rawSurface !== null
          ? (rawSurface as Record<string, unknown>)
          : undefined;
      for (const name of names) {
        reflected[name] = typeof raw?.[name];
      }
      return Promise.resolve(reflected);
    },

    // Through `harness.debug`, so a build with no usable surface fails here on
    // the surface fault rather than answering `undefined`.
    debugVersion: () => Promise.resolve(harness.debug.version),

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(x, y, false),
    deviceFromWorld: (x, y) => toDevice(x, y, true),
    pixel: (x, y) => {
      const point = toDevice(x, y, false);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    patch: (col, row, half) => readPatch(harness, col, row, half),

    armAudio: () => Promise.resolve(),
    async warmAudio() {
      const heard = (): boolean => cues.length + loops.length > 0;
      for (let round = 0; round < WARM_ROUNDS && !heard(); round += 1) {
        await harness.settle(WARM_ROUND_MS);
        await step(1);
      }
      return heard();
    },
    settle: (ms) => new Promise((done) => setTimeout(done, ms)),

    dispose: () => {
      engine.destroy();
      (globalThis as unknown as Record<string, unknown>).fetch = previousFetch;
      console.error = previousConsoleError;
      if (!serveAssets) setAssetTransport(true);
    },
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Sampling                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The rendered color at a logical point: ONE device pixel, not an average.
 *
 * An average silently reads points the check never named. This is what the
 * letterbox-bar items and the background item sample with, and near a bar edge an
 * average of a cluster blends the bar with the stage — turning a check about
 * where the bar ENDS into a reading of a gradient that is not there. A check that
 * wants an area asks for a {@link Patch}, which says so in its name.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/**
 * The device-pixel box centered on a cell's center.
 *
 * `half` defaults to `PATCH_HALF` (20) LOGICAL units, so the box sits inside
 * `GEM_R` (30), where the gem's own form is drawn, and clear of every neighbor,
 * whose nearest center is `CELL_PITCH` (72) away.
 *
 * The box is `2 * round(half * scale) + 1` device pixels on a side — ODD, so it
 * is centered on the cell center rather than half a pixel off it — and it is that
 * size wherever the cell sits: at a canvas edge the ORIGIN slides inward and the
 * size holds. `patchDistance` is a MEAN over the box, and `PATCH_DISTINCT_MIN`
 * and `PATCH_SAME_MAX` are one pair of thresholds under all three engines, so a
 * box that changed shape near an edge would make them mean different things.
 */
export function readPatch(
  h: Harness,
  col: number,
  row: number,
  half: number = PATCH_HALF,
): Patch {
  const view = h.viewport();
  const center = cellCenter(col, row);
  const device = h.device(center.x, center.y);
  const halfDev = Math.max(1, Math.round(half * view.scale));
  const size = halfDev * 2 + 1;
  const x0 = Math.max(0, Math.min(h.canvas.width - size, device.x - halfDev));
  const y0 = Math.max(0, Math.min(h.canvas.height - size, device.y - halfDev));
  const image = h.ctx.getImageData(x0, y0, size, size);
  return {
    half,
    width: image.width,
    height: image.height,
    data: image.data as unknown as Uint8ClampedArray,
  };
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every ONE-SHOT cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which tells a build that plays a cue on the right event apart from one
 * that plays it every frame, or a frame late.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count, loop: false });
  });
  return played;
}

/**
 * Record every LOOPING cue, which under specs/ui.md is what the two music beds
 * are.
 *
 * Kept apart from {@link watchCues} for one reason: a screen change starts a bed,
 * and a bed starting must never be able to answer a point about a one-shot cue.
 */
export function watchLoops(h: Harness): TimedCue[] {
  const looped: TimedCue[] = [];
  h.engine.events.on("cue:looped", ({ cue, t, gain }) => {
    looped.push({ cue, t, gain, frame: h.engine.frame().count, loop: true });
  });
  return looped;
}

/** The cues attributed to one frame. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/**
 * Just the names, in order.
 *
 * `null` under `none`, where the names are inside the build's own code and
 * nothing on the page reports them; a real name here. A check asserts
 * CONTAINMENT of a frame's cues and never exclusivity: specs/ui.md has `clear`
 * sound the chain ladder and calls the rungs "that one cue's sources rather than
 * events of their own", so a build is entitled to name a rung on the bus beside
 * the cue itself.
 */
export function cueNames(cues: readonly TimedCue[]): (string | null)[] {
  return cues.map((cue) => cue.cue);
}

/* -------------------------------------------------------------------------- */
/* Counting frames for a duration                                             */
/* -------------------------------------------------------------------------- */
//
// A step's hold is the STEP's own figure rather than a constant: it is
// `board.ts`'s `stepHold` over the `lastWaves` R6 gave that step's clear set and
// the `lastFall` R9 left on the board, and the snapshot reports it. So the
// frames that carry a scenario across a hold cannot be a constant either. These
// two turn a duration into a whole number of the suite's frames, and every drive
// below counts through them.

/**
 * The most frames of the suite's clock that fit STRICTLY INSIDE `seconds`.
 *
 * `ceil(seconds / TICK_S) - 1`, so the frames sum to less than `seconds` even
 * where `seconds` is an exact multiple of `TICK_S`. At `REFUSAL_SECONDS`
 * (`0.3` s) it is 19 frames, `0.296875` s, which is the figure
 * `REFUSAL_FRAMES_BEFORE` writes down for that one duration.
 *
 * What a check reaches for to stop SHORT of a threshold and read the state a
 * build is holding just before it.
 */
export function framesShortOf(seconds: number): number {
  return Math.max(0, Math.ceil(seconds / TICK_S) - 1);
}

/**
 * The fewest frames of the suite's clock that carry the game PAST `seconds`,
 * with a whole frame to spare.
 *
 * `ceil(seconds / TICK_S) + 1`. The `ceil` alone only REACHES `seconds`, which a
 * build comparing `>=` acts on and one comparing `>` does not; the extra frame
 * puts a full `TICK_S` (`0.015625` s) of game time beyond it, so both
 * comparisons have fired and no reading taken afterwards depends on which one
 * the build wrote.
 *
 * The overshoot is therefore at most two frames, `0.03125` s, which is what
 * keeps a drive sized this way clear of a SECOND threshold of the same length.
 */
export function framesPast(seconds: number): number {
  return Math.ceil(seconds / TICK_S) + 1;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. They fix only the arrangement: which board, which cells.
// Every threshold a check asserts is stated in the check itself, derived from the
// figure or rule specs/ states for it.
//
// COMPOUND SEQUENCES LIVE HERE, NOT ON THE SURFACE. Every operation
// specs/instrumentation.md puts on the debug surface writes ONE element of the
// state, reads it, or moves the clock. Beginning a round, opening the next
// level, quitting to the title and reaching a screen are each several of those
// in a row, and the surface carries no operation for any of them — so those
// sequences are written once, here, where the suites of all three engine
// projects share one copy. What each one arranges is specs/rules.md's and
// specs/ui.md's account of the same transition, field by field.
//
// THE ITEMS THAT DECIDE THOSE TRANSITIONS DO NOT REACH FOR THESE HELPERS.
// Whether `PLAY` really opens a round, `CONTINUE` really opens the next level
// and `QUIT` really returns to the title is what `screens/start-round`,
// `levels/continue-opens-next-level` and `screens/quit-to-title` decide, by
// working the menu the way a player does and reading what the build did. Every
// other check reaches its scenario through here instead, so a build with a
// broken title menu fails those items rather than every item in the project.

/**
 * Write a board onto the game and change NOTHING else.
 *
 * One crossing, and the atomic operation specs/instrumentation.md states:
 * `loadBoard(rows)` writes the board's dimensions and its cells, and "the
 * screen, `menuIndex`, the phase and its timers, the selection, the offer, the
 * refusal, and every figure of the round stand where they were". What a check
 * reaches for when it must put a board under a move already in motion —
 * replacing the gems a running step will read next without disturbing the step.
 *
 * The rows are parsed on this side FIRST, so a fixture typo fails the FIXTURE
 * with the token it could not read rather than crossing into the build and
 * failing it for a mistake the check made.
 *
 * {@link loadBoard} is the one to reach for otherwise: it poses the board on a
 * settled `playing` screen, which is the situation nearly every scenario wants.
 */
export function writeBoard(h: Harness, rows: BoardRows): FacetSnapshot {
  parseRows(rows);
  h.debug.loadBoard(rows);
  return h.snapshot();
}

/**
 * Pose a written board on a settled `playing` screen, and read it back.
 *
 * THE SEQUENCE, not one operation: the board is written, resolution is settled,
 * the selection, the offer and the refusal are put away, the menu highlight goes
 * back to its resting `0` and the screen becomes `playing`. That is the world
 * nearly every scenario in this project wants to stand on — a board, in play,
 * with nothing of an earlier scenario standing on it.
 *
 * No frame is advanced. Every operation in it takes effect at its call, so the
 * arrangement is complete in the state this reads back.
 *
 * A check that wants ONLY the cells written, leaving the screen and the move in
 * motion alone, calls {@link writeBoard}.
 */
export function loadBoard(h: Harness, rows: BoardRows): FacetSnapshot {
  parseRows(rows);
  h.debug.clearChain();
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.loadBoard(rows);
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Begin a fresh round, exactly as choosing `PLAY` from the title does.
 *
 * Every figure specs/rules.md returns to its opening value when a round starts,
 * written one at a time, and then the opening board dealt through the game's own
 * code from `rngState` — which is the one part of it that cannot be decomposed,
 * since what makes a dealt board an opening board is R4 and the generator rather
 * than any cell a check could write.
 *
 * `PLAY AGAIN` on the game-over menu opens the same round; specs/ui.md gives the
 * two menu items the same effect.
 */
export function startRound(h: Harness): FacetSnapshot {
  h.debug.setScore(0);
  h.debug.setLevel(1);
  h.debug.setLevelScore(0);
  h.debug.setMoveScore(0);
  h.debug.setBestMove(0);
  h.debug.setBestChain(0);
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.clearChain();
  h.debug.dealBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Open the next level, exactly as choosing `CONTINUE` from the level-clear menu
 * does.
 *
 * {@link startRound} with two differences, and both are specs/rules.md's:
 * `score` CARRIES — it is the round's total and a level boundary does not touch
 * it — and `level` goes up by one from wherever the round had reached rather
 * than back to `1`. The level's target follows from `level`, so nothing here
 * writes it.
 */
export function openNextLevel(h: Harness): FacetSnapshot {
  const before = h.snapshot();
  h.debug.setLevel(before.level + 1);
  h.debug.setLevelScore(0);
  h.debug.setMoveScore(0);
  h.debug.setBestMove(0);
  h.debug.setBestChain(0);
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.clearChain();
  h.debug.dealBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Abandon the round and return to the title, exactly as choosing `QUIT` from
 * either menu that offers it does.
 *
 * specs/ui.md: "Sets `screen = title` and `menuIndex = 0`, abandoning the
 * round." The round is abandoned by taking the board out of play and putting
 * away everything that stood on it; `score` and `level` are left where the round
 * left them, since the title screen reports neither and the next round's
 * {@link startRound} writes both.
 */
export function quitToTitle(h: Harness): FacetSnapshot {
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.clearChain();
  h.debug.clearBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("title");
  return h.snapshot();
}

/**
 * Open the instructions, exactly as choosing `HOW TO PLAY` from the title does.
 *
 * specs/ui.md: "Sets `screen = howto`", and `menuIndex` is `0` on entering every
 * screen but the title entered from here.
 */
export function openHowTo(h: Harness): FacetSnapshot {
  h.debug.setMenuIndex(0);
  h.debug.setScreen("howto");
  return h.snapshot();
}

/**
 * Pause the round, exactly as the `pause` action from `playing` does.
 *
 * The board is left exactly as it stands — specs/ui.md shows it behind the menu,
 * quieted — and only the screen and the menu highlight move.
 */
export function pauseGame(h: Harness): FacetSnapshot {
  h.debug.setMenuIndex(0);
  h.debug.setScreen("paused");
  return h.snapshot();
}

/**
 * Return to the round, exactly as choosing `RESUME` from the pause menu does.
 *
 * specs/ui.md: "Sets `screen = playing`, with the board exactly as it was left."
 * The highlight goes back to the `0` specs/ui.md rests it at on `playing`.
 */
export function resumeGame(h: Harness): FacetSnapshot {
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Stand the game on `screen`, with whatever that screen needs behind it.
 *
 * REACHED DIRECTLY, through the atomic poses, rather than by playing the game
 * into it. specs/instrumentation.md's `setScreen` shows a screen and changes
 * nothing else, and "the screen behaves from there exactly as it does when a
 * player reaches it" — so a check whose requirement is ABOUT a screen stands on
 * it in two crossings instead of driving a chain to its end through the level
 * and end conditions, which are other items' requirements and other items'
 * failure modes.
 *
 * The four screens specs/ui.md draws a board behind get one: a quiet filler
 * carrying no run and one legal swap, so the board behind the menu is a board a
 * round could really be standing on.
 */
export function reachScreen(h: Harness, screen: Screen): FacetSnapshot {
  h.debug.reset();
  if (screen !== "title" && screen !== "howto") {
    loadBoard(h, quietRowsWithEscape([]));
  }
  if (screen !== "title") {
    h.debug.setMenuIndex(0);
    h.debug.setScreen(screen);
  }
  const reading = h.snapshot();
  if (reading.screen !== screen) {
    fail(`the ${screen} screen these poses ask for`, reading.screen);
  }
  return reading;
}

/**
 * Take the item at `index` on whichever menu the current screen shows, the way a
 * player takes it.
 *
 * TWO HALVES, AND ONLY ONE OF THEM IS DRIVEN. The highlight is POSED —
 * `setMenuIndex` "highlights the menu item at `index` … and no item is taken" —
 * so a build whose `up` and `down` never worked is still asked this question,
 * and which item the highlight lands on stays the menu items' own point. What is
 * really driven is the `confirm` that takes it, through the key
 * specs/controls.md binds and the build's own input path.
 *
 * This is what the items whose requirement IS the choice reach for: "Choosing
 * PLAY", "Choosing QUIT", "Choosing CONTINUE", "Choosing RESUME". Every other
 * check stands on the screen it needs through {@link reachScreen} and never
 * presses a menu at all.
 */
export async function takeMenuItem(
  h: Harness,
  index: number,
): Promise<FacetSnapshot> {
  h.debug.setMenuIndex(index);
  await h.tapAction("confirm");
  return h.snapshot();
}

/**
 * Pose the run-free filler with the scenario's own cells written over it: the
 * one-line way to arrange an isolated world.
 *
 * THE FILLER CARRIES NO LEGAL SWAP OF ITS OWN, which is what makes a scenario
 * isolated — the only productive swap on the posed board is the one the check
 * put there. It has a consequence a check author must know: specs/rules.md ends
 * the round when a chain settles on a board with no legal swap, so a scenario
 * posed this way will usually find `screen` at `gameover` once its chain
 * SETTLES. That is the specification behaving correctly, not a fault.
 *
 * So: read `phase`, `lastCleared`, `lastPoints`, `score` and the board — never
 * `screen` — after a chain posed this way; or use {@link poseBoardWithEscape},
 * which plants one spare legal swap in the far corner and keeps the round alive.
 */
export function poseBoard(
  h: Harness,
  cells: readonly PlacedToken[],
): FacetSnapshot {
  return loadBoard(h, quietRowsWith(cells));
}

/**
 * {@link poseBoard} with one spare legal swap planted in the bottom-left corner,
 * so the round is not already over at the moment the scenario is posed.
 *
 * For every check that must still be `playing` afterwards: the level items, the
 * HUD items, and anything that goes on to make a second swap.
 *
 * WHAT IT GUARANTEES IS ABOUT THE POSED BOARD. The escape does not survive an
 * arbitrary chain: a clear reaching the bottom-left corner takes the escape's own
 * cells with it, and R9's refill drops what is left out of position. A check that
 * must still be `playing` once its chain has SETTLED keeps its scenario clear of
 * rows 6-7 and columns 0-2, and asserts `snapshot().legalSwap` before it reads
 * `screen`.
 */
export function poseBoardWithEscape(
  h: Harness,
  cells: readonly PlacedToken[],
): FacetSnapshot {
  return loadBoard(h, quietRowsWithEscape(cells));
}

/**
 * Request a swap and read the state THE REQUEST ITSELF left, with no frame
 * advanced.
 *
 * WHAT IT RETURNS. Either the standing refusal, or the swap in motion:
 * specs/rules.md has an accepted swap exchange the two cells at once, set
 * `phase` to `swapping`, set `swapTimer` to `0` and leave `chainStep` at `0`,
 * and step 1 does not resolve until `SWAP_SECONDS` (`0.18`) of game time has
 * passed. NOTHING IS CLEARED in the reading this hands back, and a check that
 * reads `lastCleared`, `lastPoints` or a settled board off it is reading the
 * board as it stood before the chain.
 *
 * SO REACH FOR IT ONLY when the check is about the REQUEST — a refusal under R1,
 * R2 or R3, or the swapping phase itself. Every other check wants
 * {@link swapAndStep}, which carries the game through the animation to step 1's
 * result, or {@link swapAndResolve}, which carries it to the end of the chain.
 */
export function requestSwap(h: Harness, a: CellRef, b: CellRef): FacetSnapshot {
  h.debug.requestSwap(a.col, a.row, b.col, b.row);
  return h.snapshot();
}

/**
 * Request a swap and carry it through the swap animation to the result of step
 * 1. THE ONE most checks about a move want.
 *
 * `SWAP_DRIVE_FRAMES` is sized in `constants.ts` for exactly this drive: 14
 * frames, `0.21875` s. `swapTimer` reaches `SWAP_SECONDS` (`0.18`) on the
 * twelfth frame, at `0.1875` s, so the swap is over whether the build compares
 * `>=` or `>` and step 1 has resolved; the `0.0075` s of overrun carries into
 * `stepTimer`, the two remaining frames add `0.03125` s, and the step is left
 * `0.03875` s into a hold of at least `0.3` s. Exactly one step has resolved
 * when this returns, on every board.
 *
 * A REFUSED swap is carried through the same frames and comes back refused. The
 * board never left `idle`, and `0.21875` s is inside `REFUSAL_SECONDS` (`0.3`),
 * so the refusal is still standing to be read — which is why a check may use
 * this even where it does not know in advance whether the swap will be taken.
 */
export async function swapAndStep(
  h: Harness,
  a: CellRef,
  b: CellRef,
): Promise<FacetSnapshot> {
  requestSwap(h, a, b);
  await h.advance(SWAP_DRIVE_FRAMES);
  return h.snapshot();
}

/**
 * The frames one {@link advanceStep} drives from the state `snapshot` reports.
 *
 * TWO CASES, because a move in motion is in one of two phases and the two are
 * timed by different figures.
 *
 * While `phase` is `swapping` it is `SWAP_DRIVE_FRAMES`, the drive above: past
 * `SWAP_SECONDS` into step 1, and far short of that step's own end.
 *
 * Otherwise it is `framesPast(stepHold - stepTimer)`. The hold is the step's own
 * figure — the snapshot reports it, derived from the `lastWaves` and `lastFall`
 * that step left — and `stepTimer` is how much of it has already run, so what is
 * driven is the REMAINDER plus the frame or two that carries the boundary. Since
 * the boundary is crossed with at most `0.03125` s to spare and the SHORTEST
 * hold any step can have is `0.3` s (`lastWaves` is `0` when the clear set is
 * its seed alone, and `lastFall` is at least `1` because a step that cleared
 * anything refills at least one cell from above row `0`), a drive sized this way
 * never reaches a second board read. A build that reads the board twice inside
 * one hold therefore shows up as an extra chain step rather than being hidden.
 *
 * Exported because a check about the cadence itself needs the same arithmetic
 * from the other side: `framesShortOf(stepHold)` stops before the boundary, this
 * carries past it.
 */
export function stepDriveFrames(snapshot: FacetSnapshot): number {
  if (snapshot.phase === "swapping") return SWAP_DRIVE_FRAMES;
  return framesPast(Math.max(0, snapshot.stepHold - snapshot.stepTimer));
}

/**
 * Carry the board past exactly one boundary of the move in motion: the end of
 * the swap animation, or the end of the step in progress.
 *
 * The count is {@link stepDriveFrames} read off the state AS IT STANDS rather
 * than a constant, because a step's hold is the step's own figure and two steps
 * of one chain rarely hold for the same time.
 */
export async function advanceStep(h: Harness): Promise<FacetSnapshot> {
  await h.advance(stepDriveFrames(h.snapshot()));
  return h.snapshot();
}

/**
 * Drive a move to its end, or report that it never ended.
 *
 * It ALWAYS RETURNS. `maxSteps` is a cap rather than a wait: a build whose chain
 * never settles comes back as `settled: false` and fails its own item, instead
 * of hanging and costing the whole run the suite's wall-clock budget.
 *
 * A board still `swapping` is driven too, so this may be called straight after
 * {@link requestSwap} as readily as after {@link swapAndStep}. `steps` is
 * therefore a count of the BOUNDARIES driven past rather than of the chain steps
 * that resolved, and a check that wants the depth a chain reached reads
 * `bestChain` off the settled snapshot.
 */
export async function resolveChain(
  h: Harness,
  options: { maxSteps?: number } = {},
): Promise<SettleResult> {
  const maxSteps = options.maxSteps ?? MAX_CHAIN_STEPS;
  let snapshot = h.snapshot();
  let steps = 0;
  let frames = 0;
  while (snapshot.phase !== "idle" && steps < maxSteps) {
    frames += stepDriveFrames(snapshot);
    snapshot = await advanceStep(h);
    steps += 1;
  }
  return { settled: snapshot.phase === "idle", steps, frames, snapshot };
}

/**
 * Play a swap and carry it all the way, keeping BOTH readings.
 *
 * `first` is step 1 as {@link swapAndStep} left it — its `lastCleared`,
 * `lastPoints`, `chainStep` and `multiplier` all describe that one step — and
 * `settled` is where the chain came to rest.
 */
export async function swapAndResolve(
  h: Harness,
  a: CellRef,
  b: CellRef,
): Promise<{ first: FacetSnapshot; settled: SettleResult }> {
  const first = await swapAndStep(h, a, b);
  const settled = await resolveChain(h);
  return { first, settled };
}

/* -------------------------------------------------------------------------- */
/* The pointer, gesture by gesture                                            */
/* -------------------------------------------------------------------------- */
//
// specs/controls.md plays the whole board with the pointer. A press takes hold
// of a gem, a move while held offers it into an orthogonal neighbor or withdraws
// the offer, and the RELEASE with an offer standing is what requests the swap —
// so a move is a GESTURE rather than a call, and a player who carries a gem onto
// its neighbor and back again has played nothing. These break that gesture into
// the three operations the surface carries, and compose the whole of it.
//
// BUILT FROM THE ATOMS ALONE. Every helper below goes through `pointerDown`,
// `pointerMove` and `pointerUp` and through nothing else. The point of a pointer
// check is that the BUILD's own press, move and release rules produced the
// outcome; a helper that reached for `setSelection`, `setOffer` or `requestSwap`
// to arrive there would be posing the very answer the check is about to read.
//
// EACH TAKES AN OPTIONAL `device`. specs/controls.md reads a mouse, a pen and a
// finger the same way, so the same gesture is posed as a touch by naming one.
// The argument is OMITTED rather than passed as `undefined` when the caller
// named none, so a mouse gesture poses exactly the call a check writing it out
// by hand would make and the specification's own default is what supplies
// `mouse`.
//
// NO FRAME IS RUN. Each of the three operations takes effect at the call
// (specs/instrumentation.md), so a whole gesture is posed without the game
// advancing at all, and `simTime`, `stepTimer` and the refusal timer stay
// readable exactly as the specification states them. A check that needs the
// gesture DRAWN, or that is about the cue an event plays, advances a frame
// itself.

/** Press the pointer at a logical stage point. */
export function pressPoint(
  h: Harness,
  x: number,
  y: number,
  device?: PointerDevice,
): FacetSnapshot {
  if (device === undefined) h.debug.pointerDown(x, y);
  else h.debug.pointerDown(x, y, device);
  return h.snapshot();
}

/**
 * Move the pointer to a logical stage point. While it is held down that is a
 * DRAG, which is the only kind of move the board reads.
 */
export function movePointer(
  h: Harness,
  x: number,
  y: number,
  device?: PointerDevice,
): FacetSnapshot {
  if (device === undefined) h.debug.pointerMove(x, y);
  else h.debug.pointerMove(x, y, device);
  return h.snapshot();
}

/** Release the pointer where it stands: the edge that plays a standing offer. */
export function releasePointer(
  h: Harness,
  device?: PointerDevice,
): FacetSnapshot {
  if (device === undefined) h.debug.pointerUp();
  else h.debug.pointerUp(device);
  return h.snapshot();
}

/**
 * Press on a cell, at its center.
 *
 * The center rather than an offset, because specs/controls.md targets "the cell
 * whose center is nearest the pointer position, when that center lies within
 * `GEM_HIT_R` of it" — and a press at the center is the only position that
 * targets one cell under every reading of that sentence. A check that is about
 * the RADIUS poses its own point through {@link pressPoint}, with
 * `board.ts`'s `insideCell`, `betweenCells` or `offBoardPoint`.
 */
export function pressCell(
  h: Harness,
  cell: CellRef,
  device?: PointerDevice,
): FacetSnapshot {
  const at = cellCenter(cell.col, cell.row);
  return pressPoint(h, at.x, at.y, device);
}

/** Carry a held pointer onto a cell, at its center: the drag that offers. */
export function dragOntoCell(
  h: Harness,
  cell: CellRef,
  device?: PointerDevice,
): FacetSnapshot {
  const at = cellCenter(cell.col, cell.row);
  return movePointer(h, at.x, at.y, device);
}

/**
 * The whole gesture that plays a move: press on `from`, carry the pointer onto
 * `to`, release there.
 *
 * Three operations and no shortcut, so what decides the outcome is the build's
 * own press, move and release rules. The reading handed back is the one the
 * RELEASE left — the swap requested and in motion, or refused, or nothing at all
 * when the build withdrew the offer — so a check about what the move DID drives
 * on from here with {@link advanceStep} or {@link resolveChain}.
 *
 * `to` need not be a neighbor of `from`: a gesture that ends over a cell the
 * rules offer nothing into is exactly the gesture several checks pose, and this
 * poses it faithfully rather than refusing it.
 */
export function dragGem(
  h: Harness,
  from: CellRef,
  to: CellRef,
  device?: PointerDevice,
): FacetSnapshot {
  pressCell(h, from, device);
  dragOntoCell(h, to, device);
  return releasePointer(h, device);
}

/**
 * The target the screen `snapshot` reports carries under `id`.
 *
 * A target's rectangle is the BUILD's — specs/controls.md fixes each screen's
 * ids and four requirements over every rectangle, and leaves the design of them
 * to the build — so a check reads the rectangle it is going to press off the
 * snapshot rather than writing one down. This is that lookup, in one place, so a
 * dozen checks do not each repeat it and a screen missing a target it owes fails
 * with the ids it did report rather than with a `TypeError`.
 */
export function targetById(snapshot: FacetSnapshot, id: string): TargetRect {
  const found = snapshot.targets.find((target) => target.id === id);
  if (found === undefined) {
    fail(
      `a pointer target ${JSON.stringify(id)} on the ${snapshot.screen} screen`,
      snapshot.targets.map((target) => target.id),
    );
  }
  return found;
}

/**
 * Move the pointer within a target, at its center: the hover that moves the
 * highlight.
 *
 * The center is where specs/instrumentation.md guarantees a hit — "a target's
 * rectangle is the one the game actually hit-tests against, so pressing and
 * releasing at a listed target's center takes that target" — so it is the one
 * position a check may press without asserting anything about the build's
 * layout.
 */
export function moveOverTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): FacetSnapshot {
  const at = targetCenter(target);
  return movePointer(h, at.x, at.y, device);
}

/** Press inside a target, at its center: the press that highlights and arms. */
export function pressTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): FacetSnapshot {
  const at = targetCenter(target);
  return pressPoint(h, at.x, at.y, device);
}

/**
 * Press and release inside a target, at its center: the gesture that TAKES it.
 *
 * Both edges at the same point, which is the only gesture specs/controls.md
 * makes take a target — "releases within the armed target" — so a check that
 * releases anywhere else composes the atoms itself and reads what was not taken.
 */
export function takeTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): FacetSnapshot {
  pressTarget(h, target, device);
  return releasePointer(h, device);
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` or an `image` OUTPUT beside its verdict:
// what the build itself drew while a check drove it, kept as evidence a reviewer
// can scrub and compare against the reference implementation's.
//
// Four properties make it usable, and each is deliberate:
//
//  1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//     caller's scenario and disarmed the moment it returns, so what is kept is
//     the part the check is ABOUT and never the setup that got there.
//  2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//     back, and a scenario that THROWS still writes what it had — a failing check
//     is the one whose replay a reviewer most wants. Nothing here can turn a
//     passing check into a failing one.
//  3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//     leaves no file, so the run reports the output absent rather than offering
//     the reviewer a replay of nothing.
//  4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//     directory is unset and the whole thing is a no-op that still runs the
//     scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
export const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
 */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's own root, one level above the staged project. */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/runs/r4-horizontal-run.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here keeps
 * that address the same when this suite is run in place against a reference for
 * `tcab capture-baselines`, where the project root is `validation/<engine>/`.
 */
export const STAGED_PROJECT_DIR = "validation";

export { MAX_REPLAY_FRAMES };

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 */
export function mediaDestination(
  outputId: string,
  extension: string,
): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/** A value's JSON with object keys in a fixed order, as a table's dedupe key. */
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
 * in the file that no surviving frame asks for.
 *
 * Exported for the suite beside this file: a recording carrying an own field
 * named `__proto__` is one the engine's recorder writes and this one has to
 * rewrite as a field rather than as a prototype.
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
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
    const rewritten: Record<string, DrawValue> = {};
    for (const [key, held] of Object.entries(record)) {
      // Defined rather than assigned: a build's own object may carry a field
      // named `__proto__`, and assigning that name reaches the prototype setter
      // instead of writing a field the document carries.
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
 * first few seconds at the full one. Each kept frame's `deltaMs` is restated as
 * the time since the frame kept before it, so the deltas still sum to the
 * section's elapsed time. The last frame is always kept: it is the frame the
 * check's drive stopped at, and the one a reviewer looks at first.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
  const kept: RecordedFrame[] = [];
  let previousMs = frames[0].timeMs - frames[0].deltaMs;
  const keep = (frame: RecordedFrame): void => {
    kept.push({ ...frame, deltaMs: frame.timeMs - previousMs });
    previousMs = frame.timeMs;
  };

  for (let i = 0; i < frames.length; i += stride) keep(frames[i]);
  const last = frames[frames.length - 1];
  if (kept[kept.length - 1].count !== last.count) {
    if (kept.length >= MAX_REPLAY_FRAMES) {
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
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the reviewer would
 * open the player on nothing. What lands on disk is gzip rather than raw JSON,
 * which is what keeps a run's whole set of recordings to a few megabytes.
 *
 * Never throws. A directory that cannot be made says something about the machine
 * the validators ran on, and failing the point over it would blame the build for
 * the host's problem.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const settled = await captureReplay(h, "chain", () => resolveChain(h));
 * assertTrue(settled.settled);
 * ```
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
 * For a point whose evidence is one PICTURE rather than a stretch of motion.
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the `advance(1)` that poses the thing under test and before the
 * assertions, so a check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* The build's own tree                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The built site, or the committed `public/` tree when nothing has been built:
 * where a check about a PRODUCED FILE looks for it.
 *
 * specs/assets.md commits every produced file under `public/assets/` and says the
 * build copies that directory into `dist/` unchanged, so both layouts name the
 * same asset by the same path below the root.
 */
export function siteRoot(): string | null {
  for (const candidate of ["dist", "build", "out", "public"]) {
    const path = join(WORKSPACE_ROOT, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}
