// Cascade — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
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
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly, and immediately: under this engine a
// pose acts on the live game at the moment of the call and a reading is built at
// the call (specs/instrumentation.md), so a scenario poses and then reads with
// no frame in between. The three pointer operations resolve their event before
// they return, so a whole gesture — press, sweep, release — is driveable without
// advancing the game at all. A frame is advanced when the check wants the game
// to RUN: a flyer to travel, a launch clock to tick, a frame to be drawn.
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
// `SurfaceMetrics` this harness supplies, so nothing here needs a document. The
// exception is the cascade's painted layer, which a build keeps on an offscreen
// drawing surface of its own (specs/victory.md); `./canvas-shim` stands both
// browser ways of making one up, and it is imported FIRST below so it is in
// place before a single module of the build has been evaluated.

import "./canvas-shim";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
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
import {
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
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import { ALL_SUITS, type CardSpec } from "./fixtures";
import type {
  CascadeDebugApi,
  CascadeSnapshot,
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

/** A point in the stage's logical units. */
export interface Point {
  x: number;
  y: number;
}

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
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

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

/** A 2D affine transform, as the context held it at the moment of a call. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever transform the pipeline applied, the measured width
 * under the current font, and the alignment that places the run about its
 * anchor.
 */
export interface TextGeometry {
  transform: Matrix;
  width: number;
  textAlign: string;
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * `transform` is carried on the calls whose arguments are POSITIONS — the
 * rectangle calls and `drawImage` — because those arguments are stated in
 * whatever space the context held at the call, and only the transform maps them
 * back to the stage's logical units.
 */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      text?: TextGeometry;
      transform?: Matrix;
    }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  t: number;
  gain: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

export interface HarnessOptions {
  /** Frames per second of the harness's `ConstantClock`. Defaults to {@link TICK_HZ}. */
  hz?: number;
  /** A clock of the check's own, for a check whose subject IS the step size. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
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
  snapshot: CascadeSnapshot;
}

/** The three pointer events the engine's own listeners answer. */
export type PointerEventType = "pointerdown" | "pointermove" | "pointerup";

export interface Harness {
  readonly engine: Engine<CascadeSurface>;
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
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live game at the moment of the call.
   */
  readonly debug: CascadeDriver;
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
  /**
   * Every call and property set the render made, oldest first, back to a
   * bounded number of the most recent — see {@link MAX_RECORDED_CALLS}.
   *
   * The way to read ONE frame's calls is {@link drawFrame}, which clears this
   * first, so what it hands back is exactly that frame's and the bound cannot
   * reach it.
   */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];
  /** The frames per second of the clock currently installed. */
  readonly hz: number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): CascadeSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Run whole frames of this harness's clock covering `duration` seconds. */
  advanceSeconds(duration: number): Promise<void>;
  /** Frames of this harness's clock covering `duration` seconds. */
  framesFor(duration: number): number;
  /** Seconds of game time in `frames` frames of this harness's clock. */
  secondsFor(frames: number): number;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: CascadeSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

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

  /**
   * Dispatch one pointer-shaped event at the surface's own event target — the
   * REAL input path, which the engine turns into the frame's ordered samples.
   *
   * The debug surface's `pointerDown`/`pointerMove`/`pointerUp` take effect at
   * the call and are what almost every check drives; this is the path that
   * proves a build answers the SAMPLE LIST, because the events dispatched
   * between two frames all arrive inside the next one.
   */
  pointer(type: PointerEventType, x: number, y: number): void;
  /**
   * The event target the surface hands the engine — where the engine's own
   * input system attached its listeners, and where the engine's overlay listens
   * for the backtick.
   */
  readonly events: EventTarget;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): void;
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
 * `isPrimary`, structurally, so a plain `Event` carrying them drives its
 * pointer exactly as a browser's does.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: PointerEventType, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/**
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates
 * coincide, which is the space every figure the specification fixes is stated in — so the projection is the identity unless the build moved it, and mapping
 * through it keeps the reading honest either way.
 */
function toDevice(world: World, view: Viewport, x: number, y: number): Point {
  const logical = world.camera.worldToLogical({ x, y });
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
  };
}

/**
 * The context calls whose arguments are POSITIONS, and which therefore carry
 * the transform they were made under.
 *
 * The path calls are in here as well as the rectangle ones, because a card is
 * not necessarily a rectangle CALL: a build that rounds its corners draws the
 * same footprint as a path of lines and curves, and the only way to say where it
 * put that card is to follow the path. A canvas transforms each point by the
 * transform in force when the point is added, so the transform is taken at the
 * call rather than at the `fill`.
 */
const PLACED_METHODS: readonly string[] = [
  "fillRect",
  "strokeRect",
  "clearRect",
  "rect",
  "roundRect",
  "drawImage",
  "moveTo",
  "lineTo",
  "quadraticCurveTo",
  "bezierCurveTo",
  "arc",
  "arcTo",
  "ellipse",
];

/**
 * The most calls the log holds before the oldest are dropped.
 *
 * A frame of this game is a few hundred calls, so this is hundreds of frames'
 * worth and no check that reads a picture can reach it: the way a check reads a
 * frame is {@link Harness.drawFrame}, which clears the log first and so is
 * always exact. The cap is for the checks that RUN rather than read — a whole
 * victory cascade is thousands of frames and well over a million calls — so a
 * suite that never looks at a call does not pay hundreds of megabytes to keep
 * them.
 */
const MAX_RECORDED_CALLS = 100_000;

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  const record = (call: DrawCall): void => {
    if (calls.length >= MAX_RECORDED_CALLS) {
      calls.splice(0, Math.floor(MAX_RECORDED_CALLS / 2));
    }
    calls.push(call);
  };
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
        if (PLACED_METHODS.includes(method)) {
          const m = object.getTransform();
          call.transform = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
        }
        record(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      record({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

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
 * The debug surface the BUILD's instance returned from `initialize`, read off
 * the engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (specs/instrumentation.md), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the instance returned, and
 * `null` for a game that returned none.
 *
 * What IS decided here is a return that is no surface. That is a fault in the
 * build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the real
 *   verdict under the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a check first reaches for an
 *   operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 *
 * Exported for the suite beside this file, which stands a `null` surface in
 * front of it to prove the stand-in reports rather than throwing a `TypeError`.
 */
export function readDebugSurface(
  engine: Engine<CascadeSurface>,
): CascadeSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as CascadeSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for ANY
 * member — an operation this engine's surface carries, or one a future revision
 * adds — reports the missing surface rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would replace
 * the verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): CascadeSurface {
  return new Proxy({} as CascadeSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size and the build's exported `BACKGROUND` — so one
 * harness serves every build of this case. Cascade registers no actions and
 * selects no touch layout (specs/controls.md), so neither is passed here
 * either. Everything else the build decided lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const hz = options.hz ?? TICK_HZ;
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

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<CascadeSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own table background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it, so the letterbox bars match the felt
    // (specs/overview.md).
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / hz),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: PlayedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain });
  });

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const harness: Harness = {
    engine,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance,
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,
    hz,

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),
    advanceSeconds: (duration) => engine.advance(framesFor(duration, hz)),
    framesFor: (duration) => framesFor(duration, hz),
    secondsFor: (frames) => secondsFor(frames, hz),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        await engine.advance(step);
        frames += step;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, ms));
      controller.abort();
      await running;
    },

    clearCalls: () => {
      calls.length = 0;
    },
    async drawFrame() {
      calls.length = 0;
      await engine.advance(1);
      return [...calls];
    },

    pointer: (type, x, y) => {
      events.dispatchEvent(new PointerEvt(type, x, y));
    },
    events,

    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.world, engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => engine.destroy(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one, over the engine's own draw-command recorder.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    ARM IT NARROWLY IN THIS CASE. The victory cascade blits a FULL-SCREEN image
//    every frame — the painted layer, whose content changes at every use — and
//    the recorder's capture budget is 16 MB of image bytes, past which a further
//    new image records as an opaque marker rather than a picture. So a cascade
//    replay is armed around the handful of seconds its point is about, with the
//    pose outside it; and every `replay` output in the `cascade` group runs with
//    `setTrailPainting(false)`, so the frames carry the flyers and no blit at
//    all. The three items whose requirement IS the trail read pixels instead and
//    declare `image` outputs. The three cascade replays that live in `winning`
//    record with painting left ON: each covers the win and at most the cascade's
//    first frames, which is nowhere near the budget, and the capture is worth
//    more with the real trail in it.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
//    Nothing here can turn a passing check into a failing one: a recording that
//    cannot be written is reported as an output that never turned up, which is a
//    fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering
//    the reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the
//    whole thing is a no-op that still runs the scenario. The suite behaves
//    identically either way, so a check cannot pass in one place and fail in the
//    other.

/**
 * The environment variable the runner names the media directory in.
 *
 * Unset is not an error: it is the normal state of a suite nobody is collecting
 * media from.
 */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory wherever the suite is run from.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/stock/turn-moves-turn-count.test.ts` — because that is the path
 * the review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, so a section a check drives
 * for half a minute of game time runs to tens of megabytes — a file nobody can
 * serve to a reviewer and nobody wants in a run's artifacts. The cap is what
 * makes `captureReplay` safe to wrap ANY section in: an author arms the recorder
 * around what the check is about and never has to reason about how long that
 * turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a run crossing the table, a card arcing to the floor, a stock turning — are
 * written whole.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its
 * own path would be free to write its evidence under some other point's address.
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
 * to hold one copy of each, and the key order inside an argument the build
 * passed is the build's own business rather than ours.
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
 * whole point is to say each thing once.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill
 * name operations and resources, whose own creating calls may name images. What
 * is deduplicated is the rewritten entry, so an operation two hundred frames
 * issue identically is written once and named two hundred times, and every index
 * a frame carries addresses the table it was interned into.
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
      // A frame inherits the current path along with the clip: a canvas keeps
      // its path across a frame boundary, and applying a clip leaves the clip
      // outline current, so a state that stopped at the clip would leave a bare
      // `fill` among the frame's operations filling that outline.
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
 * An over-long section is THINNED rather than cut short: every nth frame is
 * kept, so the reviewer sees the entire section at a lower frame rate instead of
 * its first — or last — few seconds at the full one. That is the reading that
 * matches what these outputs are named for. A sweep is evidence that the run
 * followed the pointer across the table, and the following is spread across the
 * whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its
 * own: a frame names the whole of the state it opened with and reaches
 * everything it draws with through tables the recording shares, so dropping the
 * frames between two kept ones cannot leave a frame undrawable. Each kept
 * frame's `deltaMs` is restated as the time since the frame kept before it, so
 * the deltas still sum to the section's elapsed time and a player pacing itself
 * off them runs at the speed the game really ran at. The frame `count` is left
 * as the host reported it, so a reader can see that frames were skipped rather
 * than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame
 * the check's sweep stopped at — the completed drop, the emptied foundations —
 * and it is the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly that
 * many frames and stops one stride short of the end: the last frame still has to
 * come in, and the cap is a ceiling rather than a target. It takes the place of
 * the final strided frame — the frame nearest it, so the swap opens the smallest
 * gap available anywhere in the section — and is measured from where that frame
 * was measured from, which is what keeps the kept deltas summing to the elapsed
 * time.
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
      // The stride spent the whole budget on the way to a frame short of the
      // end. Drop the frame it stopped on, and put the moment back to the one
      // before it: a kept frame's restated delta is measured from exactly that
      // moment, so subtracting it recovers it, and the last frame's own delta
      // then spans the gap the two of them leave.
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
 * that turned up — the run would tell the reviewer there is a replay to watch
 * and the player would open on nothing. A declared output that never turned up
 * is already reported as absent, and that is the truthful reading of a section
 * that drew no frames.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers, index lists and field names repeated once per
 * frame, which is close to the shape gzip is best at. That is what keeps a run's
 * whole set of recordings to a few megabytes. Every host that serves one
 * declares the encoding, so the browser inflates it before the player sees it,
 * and the document inside is the same one.
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
    console.warn(`cascade: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * h.debug.setTrailPainting(false);
 * const flyer = poseFlyer(h, card("hearts", KING), 600, 300, 240, -120);
 * await captureReplay(h, "bounce", () => h.advanceSeconds(1.5));
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
    // In a `finally`, so a scenario that failed still leaves its evidence
    // behind.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the dealt table, the title screen,
 * the held run over its target. A recording of a still screen would be the same
 * frame three hundred times over, and a reviewer looking at a table wants to
 * look at the table.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `h.drawFrame()` following
 * the arrangement — and before the assertions, so a check that fails still
 * leaves the picture that shows why. Nothing here can change a verdict: outside
 * a run the media directory is unset and this is a no-op, and a still that
 * cannot be written is reported as an output that never turned up, which is a
 * fact about the host rather than about the build.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`cascade: could not write ${destination}: ${String(error)}`);
  }
}

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

/** A cue the build played, and the frame of the run it played on. */
export interface TimedCue {
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, as `engine.frame().count` reports. */
  frame: number;
}

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
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/** Every recorded firing of the cue named `name`, oldest first. */
export function cuesNamed(h: Harness, name: string): PlayedCue[] {
  return h.cues.filter((cue) => cue.cue === name);
}

/** Forget every cue recorded so far, so a check reads its own section alone. */
export function clearCues(h: Harness): void {
  h.cues.length = 0;
}

/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out — well inside a
 * `100 x 140` card — so one stray anti-aliased pixel, or the hairline of a
 * border, cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const [pr, pg, pb] = h.pixel(x + dx, y + dy);
    r += pr;
    g += pg;
    b += pb;
  }
  return {
    r: r / offsets.length,
    g: g / offsets.length,
    b: b / offsets.length,
  };
}

/** The rendered colour at the middle of a card drawn with its top-left there. */
export function sampleCard(h: Harness, x: number, y: number): Rgb {
  const centre = cardCenter(x, y);
  return sampleColor(h, centre.x, centre.y);
}

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the same
 * canvas implementation the harness samples with, so a pixel the game never drew
 * over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads as
 * the engine leaves it: the engine composites its clear over the previous frame
 * every frame, which converges on the colour's own channels, and a single fill
 * over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

/**
 * The canvas's whole backing store, copied — so a check can hold two frames
 * apart and say whether anything the build drew changed between them.
 */
export function canvasPixels(h: Harness): Uint8ClampedArray {
  const { width, height } = h.canvas;
  return Uint8ClampedArray.from(h.ctx.getImageData(0, 0, width, height).data);
}

/** How many bytes differ between two {@link canvasPixels} captures. */
export function pixelsChanged(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i < length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  return changed + Math.abs(before.length - after.length);
}

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
    const sample: Rgb = { r: data[i], g: data[i + 1], b: data[i + 2] };
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
// stage's logical units through the transform recorded beside it and the
// engine's own fit — so a build that draws under a translation of its own is
// read at the position a player sees, not at the numbers it happened to pass.

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
 * case's own, but how a build presents it is the build's, and a label is
 * commonly drawn with a marker or padding around it. Requiring the exact run
 * would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * held run asked for strictly more of these than the same frame with nothing in
 * hand, whatever shape the build chose to draw it as.
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
 * Every point a frame's path and rectangle calls named, in the space the game
 * draws in.
 *
 * The pipeline sets the world-to-device transform on the context before a
 * component draws, so the coordinates a drawing call carries are the game's own
 * — and with the camera at its defaults those are logical units. The leading
 * pair of arguments is the position for every method listed, except the curve
 * calls, whose control points come first and whose endpoint is the last pair.
 *
 * `drawImage` is not in here, because its leading argument is a bitmap rather
 * than a coordinate: read those with {@link drawnImages}. The EXTENT of a shape
 * is not in here either: read that with {@link drawnShapes}, which follows the
 * path a build drew and reports the box it covered.
 */
export function drawnPoints(calls: readonly DrawCall[]): Point[] {
  const points: Point[] = [];
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
      method === "clearRect" ||
      method === "moveTo" ||
      method === "lineTo"
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
  const view = h.engine.viewport();
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
    const px = (m.a * x + m.c * y + m.e - view.offsetX) / view.scale;
    const py = (m.b * x + m.d * y + m.f - view.offsetY) / view.scale;
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

  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "beginPath") {
      clear();
      continue;
    }
    if (method === "fill" || method === "stroke") {
      emit(method);
      continue;
    }
    const m = call.transform;
    if (m === undefined) continue;
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
  }
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
 */
export function drawnImages(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnImage[] {
  const view = h.engine.viewport();
  const images: DrawnImage[] = [];
  for (const call of calls) {
    if (call.kind !== "call") continue;
    if (call.method !== "drawImage" || call.transform === undefined) continue;
    const source = call.args[0] as { width?: unknown; height?: unknown } | null;
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.width !== "number" ||
      typeof source.height !== "number"
    ) {
      continue;
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
      continue;
    }
    if (![dx, dy, dw, dh].every(Number.isFinite)) continue;

    const m = call.transform;
    const localX = Math.min(dx, dx + dw);
    const localY = Math.min(dy, dy + dh);
    const deviceX = m.a * localX + m.c * localY + m.e;
    const deviceY = m.b * localX + m.d * localY + m.f;
    images.push({
      source: source as { width: number; height: number },
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      w: (Math.abs(dw) * Math.hypot(m.a, m.b)) / view.scale,
      h: (Math.abs(dh) * Math.hypot(m.c, m.d)) / view.scale,
    });
  }
  return images;
}

/** One run of text a frame drew, and the logical x range its glyphs span. */
export interface TextSpan {
  text: string;
  /** The anchor, in logical units. */
  x: number;
  y: number;
  /** The horizontal extent of the glyphs, in logical units. */
  left: number;
  right: number;
}

/**
 * Every run of text the frame drew, placed in logical units.
 *
 * A build may anchor its text through any transform the pipeline or its own
 * drawing applies and align it any way it likes, so the anchor is mapped through
 * the transform the context held at the call and the run is extended about it by
 * its measured width and `textAlign`. Which way a `start`/`end` alignment reads
 * is the page's direction; this game draws no right-to-left text, so they are
 * left and right.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws it
 * through the same context, in device pixels under an identity transform, which
 * this mapping carries back to logical units like any other run.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;
    const { transform: m, width, textAlign } = call.text;
    // Device-space anchor, then back through the engine's fit to logical units.
    const deviceX = m.a * ax + m.c * ay + m.e;
    const deviceY = m.b * ax + m.d * ay + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    // The run's width under the same horizontal scale the anchor took.
    const w = (width * Math.hypot(m.a, m.b)) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;
    spans.push({ text, x, y, left: x - before, right: x - before + w });
  }
  return spans;
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
  h.events.dispatchEvent(new KeyEvent("keydown", "Backquote"));
  h.events.dispatchEvent(new KeyEvent("keyup", "Backquote"));
  return h.drawFrame();
}
