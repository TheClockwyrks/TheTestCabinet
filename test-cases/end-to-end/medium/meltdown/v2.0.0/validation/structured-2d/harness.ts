// Meltdown — the shared validator harness. CASE-PROVIDED.
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
// events the engine broadcast (the cues), and — for the presentation and panel
// checks — the pixels on the canvas or the calls the 2D context received.
// Nothing here fabricates an outcome: the scenario helpers below only ARRANGE
// the floor through the debug surface, and the real rules the build wrote are
// what decide every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build:
// `setTowerHeat` poses a heat the two-phase model then resolves unchanged,
// `addTower` builds a tower that blocks its footprint and re-paths the floor,
// `addUnit` enters a unit into the same pathing and combat systems the spawner
// uses, and `reset` gives everything back. Posing through it is how a scenario
// is reproducible, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never
// imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly, and immediately: under this engine a pose
// acts on the live game at the moment of the call and a reading is built at the
// call (specs/instrumentation.md), so a scenario poses and then reads with no
// frame in between. A frame is advanced when the check wants the game to RUN — a
// unit to walk, a tower to fire, heat to resolve, a render to happen.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field, so "a run open on an empty, quiet floor" is a
// helper here rather than an operation there. A check that needs only part of a
// sequence calls the operations it needs, and nothing it did not ask for
// happens. The helpers fix GEOMETRY — which tile a tower is posed on, where a
// unit is placed — and never a threshold: every figure a check asserts is stated
// in that check, derived from what specs/ fixes for it. Look for a tolerance in
// this file and you will not find one.
//
// THE CLOCK IS THE HARNESS'S. `ConstantClock(TICK_MS)` at 120 Hz, so one frame
// is one tick and a duration is a whole number of frames on every machine.
// Meltdown mandates no timestep of its own — every rate is per second and
// integrated against the delta the frame hands the game, which is why
// `[instrumentation]` carries no `tick_hz` — so the fixed clock is the SUITE's
// choice. A check that is specifically about the step size
// (heat/two-phase-resolution, instrumentation/deterministic-core) builds its own
// harnesses with clocks of its own.
//
// AND A CHECK ABOUT WHETHER TIME PASSES MEASURES ON THE BUILD'S OWN CLOCK. Never
// through a stepping operation, because a stepping operation is instrumentation
// and the question is about the game. {@link Harness.settle} hands the loop and
// a real-time clock back to the build for a window of wall-clock time, and
// {@link windowOfRealTime} brackets that window with the ONE snapshot the reading
// pair is taken from. That is what the pause, resume, own-clock and speed items
// are measured with. See "Windows on the build's own clock" below.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
  WallClock,
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
} from "@clockwyrks/structured-2d";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import {
  BINDINGS,
  BUILD_PHASE_TIME,
  DIFFICULTY_TABLE,
  FLOOR_X0,
  FLOOR_Y0,
  LAYOUT,
  MODE_TABLE,
  STAGE_H,
  STAGE_W,
  TILE,
  TOWER_DEFS,
  footprintCentre,
  tileCX,
  tileCY,
  type ActionName,
} from "./constants";
import type {
  BuildSnapshot,
  ControlRect,
  DifficultyName,
  Face,
  MeltdownDebugApi,
  MeltdownSnapshot,
  MenuRow,
  ModeName,
  Phase,
  Screen,
  ShopControl,
  SnapshotControls,
  SurgeType,
  TowerSnapshot,
  TowerType,
  UnitSnapshot,
  VentName,
  ZoneSnapshot,
} from "./surface";

export type {
  BuildSnapshot,
  ControlRect,
  DifficultyName,
  Face,
  MeltdownSnapshot,
  ModeName,
  Phase,
  Screen,
  ShopControl,
  SnapshotControls,
  SurgeType,
  TowerSnapshot,
  TowerType,
  UnitSnapshot,
  VentName,
  ZoneSnapshot,
};

/** The case's surface, exactly as `surface.ts` specifies it. */
export type MeltdownSurface = MeltdownDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain
 * data — so no wrapper stands between a check and the object the build returned,
 * and the driver type is the surface type itself. The alias is kept so a check
 * reads the same way it does under an engine whose surface needs driving.
 */
export type MeltdownDriver = MeltdownSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `MeltdownDebugApi` it exports, the `D` of its
 * `GameDefinition<D>` — and that type is the build's: what a check holds it to is
 * `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<MeltdownSurface>` here and the engine is parameterized with it.
 * A surface that departs from the specification is caught where a check reaches
 * for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<MeltdownSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took and every rate in Meltdown is per second and integrated
 * against it. Fixing it here makes a duration a whole number of frames, so a
 * tolerance can be stated in ticks and mean the same thing on every machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds, rounded to whole. */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* The long-drive clock                                                       */
/* -------------------------------------------------------------------------- */
//
// A HANDFUL OF POINTS IN THIS PROJECT NEED MINUTES OF GAME TIME. What they read
// is a negative held over a long stretch — no unit released while the gate is
// shut, no countdown started in the opening phase, no heat on a Forge under a
// minute of fire, no offline period that is not a cooldown — and the length of
// the stretch IS the requirement, so it cannot be shortened.
//
// WHAT CAN BE CHOSEN IS HOW FINELY THAT STRETCH IS DICED, AND THE SPECIFICATION
// SAYS SO. `specs/waves.md`: every rate is per second and integrated against the
// game time a frame advances by, so "an interval of game time reaches the same
// state however it was divided into frames"; no fixed timestep is mandated
// anywhere, and `instrumentation.deterministic-core` is the point that grades
// that claim on its own. The suite's {@link TICK_HZ} is a convenience for
// stating tolerances in ticks, not a figure any specification fixes.
//
// AND THE COST OF DICING IT AT `120` Hz IS NOT SMALL. Under an engine every
// advanced frame is a real frame: the same `update` a player's frame runs
// followed by a real render into the canvas. A minute of game time at the
// suite's clock is seven thousand two hundred of them, and on a floor carrying
// dozens of units that is twenty to thirty seconds of one core — which on a
// runner sharing twenty cores between two hundred tasks is four to six minutes
// of WALL CLOCK, against a per-check ceiling. A point lost there is a point lost
// to the load on the machine, which is the one thing a validator must never
// measure.
//
// SO A LONG DRIVE RUNS AT `30` Hz. A frame of a thirtieth of a second is still
// eighteen frames inside one `WAVE_SPAWN_INTERVAL` (`0.6` s), a hundred and
// fifty inside a `TRIP_TIME` cooldown (`5` s), and four hundred and fifty inside
// a build phase (`15` s), so every period these points count is resolved many
// times over — and the drive costs a quarter of what it did. A check whose
// reading has a finer resolution than a thirtieth of a second does NOT use this
// clock: it states its own, as the checks on a fire rate and a spawn cadence do.

/** The clock a check that drives minutes of game time runs on, in frames a second. */
export const DRIVE_HZ = 30;

/** Frames of {@link DRIVE_HZ} covering `duration` seconds of game time, rounded up. */
export function driveFrames(duration: number): number {
  return Math.ceil(duration * DRIVE_HZ);
}

/** Seconds of game time in `frames` frames of {@link DRIVE_HZ}. */
export function driveSeconds(frames: number): number {
  return frames / DRIVE_HZ;
}

/**
 * A harness on the {@link DRIVE_HZ} clock, for a check that needs minutes of game
 * time. Everything else about it is {@link createHarness}'s default.
 */
export function createDriveHarness(
  options: Omit<HarnessOptions, "clock"> = {},
): Promise<Harness> {
  return createHarness({
    ...options,
    clock: new ConstantClock(1000 / DRIVE_HZ),
  });
}

/**
 * How often {@link Harness.gain} asks whether the build's clock has got there
 * yet: ten times a second.
 *
 * Coarse enough that the poll is not competing for the same starved event loop as
 * the frame callback it is watching, and fine enough that a leg closes within a
 * frame or two of the game time it asked for.
 */
const GAIN_POLL_MS = 100;

/** What a leg spent on the build's own clock cost, and whether it closed. */
export interface GainResult {
  /** Whether the build's clock gained the seconds asked for before the deadline. */
  reached: boolean;
  /**
   * The real time the leg took.
   *
   * NOT a reading about the build — it is how busy the machine was — so no check
   * asserts on it. What it is for is giving a leg that must be spent in real time
   * (a PAUSED window, which cannot be closed on a gain that must never happen)
   * the same stretch of real time the running leg beside it needed, so the two
   * offer a build the same opportunity to be caught however loaded the host is.
   */
  elapsedMs: number;
}

/* -------------------------------------------------------------------------- */
/* The floor, in the space the surface speaks                                 */
/* -------------------------------------------------------------------------- */

/** A point in logical stage units. */
export interface Point {
  x: number;
  y: number;
}

/** One tile of the floor. */
export interface Tile {
  col: number;
  row: number;
}

/** A tile's centre in logical stage units, which is what the surface takes. */
export function tileCenter(col: number, row: number): Point {
  return { x: tileCX(col), y: tileCY(row) };
}

/**
 * The tile a logical stage point falls on, the inverse of {@link tileCenter}.
 *
 * A point on the casing band or the build panel answers with a tile outside the
 * grid, which is the honest reading of a point that is on no tile at all.
 */
export function tileAtPoint(x: number, y: number): Tile {
  return {
    col: Math.floor((x - FLOOR_X0) / TILE),
    row: Math.floor((y - FLOOR_Y0) / TILE),
  };
}

/** The footprint side, in tiles, of a tower of `type`. */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/**
 * The centre of the footprint a tower of `type` anchored at `(col, row)` covers,
 * in logical stage units. This is the point range is measured from.
 */
export function footprintCenter(
  type: TowerType,
  col: number,
  row: number,
): Point {
  return footprintCentre(col, row, sizeOf(type));
}

/** Every tile a footprint anchored at `(col, row)` with side `size` covers. */
export function footprintTiles(col: number, row: number, size: number): Tile[] {
  const tiles: Tile[] = [];
  for (let dr = 0; dr < size; dr += 1) {
    for (let dc = 0; dc < size; dc += 1) {
      tiles.push({ col: col + dc, row: row + dr });
    }
  }
  return tiles;
}

/** Every tile a placed tower stands on, read off the snapshot it was read from. */
export function tilesOf(tower: TowerSnapshot): Tile[] {
  return footprintTiles(tower.col, tower.row, tower.size);
}

/** The distance between two logical points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The centre of a control's hit rectangle, which is where a tap lands. */
export function rectCenter(rect: ControlRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* -------------------------------------------------------------------------- */
/* The recorded 2D context                                                    */
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

/** One recorded operation on the 2D context, in the order the render made it. */
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
        if (method === "drawImage") {
          const m = object.getTransform();
          call.transform = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
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
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
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
  snapshot: MeltdownSnapshot;
}

export interface Harness {
  readonly engine: Engine<MeltdownSurface>;
  /**
   * The world currently open, read fresh on every access. Meltdown runs in one
   * world for the whole session — every screen is a value of the state's
   * `screen` field — but reading it through the engine keeps a check honest
   * against a build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `MeltdownState` specs/state.md
   * declares — read fresh on every access. Its arrangement is the build's; what
   * a check asserts is read through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<MeltdownSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live game at the moment of the call.
   */
  readonly debug: MeltdownDriver;
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
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): MeltdownSnapshot;
  /** Run `frames` frames back to back, on the suite's own clock. */
  advance(frames: number): Promise<void>;
  /** Run whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: MeltdownSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Hand the frame loop AND a real-time clock back to the build for `ms` of
   * wall-clock time, then take both back.
   *
   * This is the measurement a question about whether time passes is decided on:
   * nothing steps the game, the build's own loop runs it off the host's frame
   * callback against a {@link WallClock}, and what the game does over the window
   * is the game's. See {@link windowOfRealTime}, which brackets it with the
   * snapshots a reading pair comes from.
   *
   * The suite's own clock is restored when the window closes, so a check may
   * step normally on either side of one.
   */
  settle(ms: number): Promise<void>;
  /**
   * Hand the frame loop AND a real-time clock back to the build until ITS OWN
   * clock has gained `seconds`, and report whether it got there before
   * `deadlineMs` of wall clock ran out.
   *
   * THE READING THAT MAKES A REAL WINDOW REPEATABLE, and the form every leg a
   * check actually asserts on should take. {@link settle} spends a fixed stretch
   * of the HOST'S clock, so what a leg covers is however many frames this machine
   * handed the loop, each of them worth at most the `WallClock`'s clamp; on a
   * runner with a hundred other things on it that is a fraction of the game time
   * the window really took, and a leg read that way fails a conformant build for
   * the load on the machine that scored it. Closing the leg on `simTime` — which
   * `specs/waves.md` says accumulates the game time every frame advances by —
   * covers the same stretch of the game however long the host takes to deliver
   * it, so everything read off the leg follows from the game rather than from the
   * runner.
   *
   * Nothing steps the game: the loop is the build's own and the clock is real.
   * What still fails is the only thing such a leg ever asked — a build whose
   * simulation does not advance unless something steps it never gains the seconds
   * and comes back with `reached` false when the deadline runs out.
   *
   * The suite's own clock is restored when the leg closes, exactly as
   * {@link settle} restores it.
   */
  gain(seconds: number, deadlineMs: number): Promise<GainResult>;

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

  /** Raise one pointer event at the engine's own event target. */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;

  /**
   * The event target the surface hands the engine — where the engine's own
   * input system attached its `keydown`/`keyup` and pointer listeners, and where
   * the engine's overlay listens for the backtick.
   *
   * {@link hold}, {@link release}, {@link tap} and {@link pointer} are the named
   * way in; this is for a check that needs to raise an event of its own shape.
   */
  readonly events: EventTarget;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
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

/** A `PointerEvent`-shaped event: the engine reads the client position. */
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
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera is never moved or zoomed in this game — world and logical
 * coordinates coincide, which is the space every figure in `constants.ts` is
 * stated in — so the projection is the identity unless the build moved it, and
 * mapping through it keeps the reading honest either way.
 */
function toDevice(
  world: World,
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const logical = world.camera.worldToLogical({ x, y });
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
  };
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
 * precondition `engine.debug` has: it holds whatever the instance returned. A
 * build whose `initialize` returned `undefined` never gets this far, because the
 * engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such a
 * build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes its
 * harness with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
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
 */
function readDebugSurface(engine: Engine<MeltdownSurface>): MeltdownSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as MeltdownSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for ANY
 * member — an operation this engine's surface carries, or one a future revision
 * adds — reports the missing surface rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): MeltdownSurface {
  return new Proxy({} as MeltdownSurface, {
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
 * passes — the design size, the build's exported `BACKGROUND`, and the four-way
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
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

  // The suite's own clock, kept so `settle` can put it back when a real-time
  // window closes.
  const suiteClock = options.clock ?? new ConstantClock(TICK_MS);

  const engine = createEngine<MeltdownSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: suiteClock,
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own opening
  // observable: construction runs no game code, so nothing has happened yet.
  const cues: PlayedCue[] = [];
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain });
  });

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const dispatchKey = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

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

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),
    advanceSeconds: (duration) => engine.advance(ticksFor(duration)),

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

    async gain(seconds, deadlineMs) {
      // The same handover `settle` makes, held open on the BUILD'S clock instead
      // of on the host's.
      engine.setClock(new WallClock());
      const from = debug.snapshot().simTime;
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      const startedMs = Date.now();
      let reached = false;
      try {
        await new Promise<void>((resolve) => {
          const check = (): void => {
            if (debug.snapshot().simTime - from >= seconds) {
              reached = true;
              resolve();
              return;
            }
            if (Date.now() - startedMs >= deadlineMs) {
              resolve();
              return;
            }
            setTimeout(check, GAIN_POLL_MS);
          };
          setTimeout(check, GAIN_POLL_MS);
        });
      } finally {
        controller.abort();
        await running;
        engine.setClock(suiteClock);
      }
      return { reached, elapsedMs: Date.now() - startedMs };
    },

    async settle(ms) {
      // A real clock for a real window: the game is handed the elapsed time each
      // frame actually took, exactly as it is in a browser.
      engine.setClock(new WallClock());
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      try {
        await new Promise((resolve) => setTimeout(resolve, ms));
      } finally {
        controller.abort();
        await running;
        engine.setClock(suiteClock);
      }
    },

    hold: (code) => dispatchKey("keydown", code),
    release: (code) => dispatchKey("keyup", code),
    async tap(code) {
      dispatchKey("keydown", code);
      dispatchKey("keyup", code);
      await engine.advance(1);
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
//    ARM IT NARROWLY. Meltdown redraws a whole floor every frame — fifty by
//    thirty-six tiles of grid, every tower's heat read, every unit's health
//    bar — so a recording that spans a scenario as well as the motion it is
//    about grows fast against the recorder's own capture budget.
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
 * `validation/waves/pause-freezes-the-floor.test.ts` — because that is the path
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
 * The cap is generous enough that the great majority of this suite's sections — a
 * unit crossing a few tiles, a tower's heat climbing to its trip, a wave entering
 * a maze — are written whole.
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
 * whole point is to say each thing once.
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
 * what these outputs are named for. A sweep is evidence that a wave crossed the
 * maze, and the crossing is spread across the whole of it.
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
 * The last frame is always kept, whatever the stride lands on: it is the frame
 * the check's sweep stopped at — the tripped tower, the cleared wave — and it is
 * the one a reviewer looks at first.
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
 * frame, which is close to the shape gzip is best at. That is what keeps a run's
 * whole set of recordings to a few megabytes. Every host that serves one declares
 * the encoding, so the browser inflates it before the player sees it, and the
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
    console.warn(`meltdown: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await captureReplay(h, "trip", async () => {
 *   await h.advanceSeconds(4);
 * });
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
 * PICTURE rather than a stretch of motion: the posed floor, a tower's heat read,
 * the build panel, the title screen. A recording of a still screen would be the
 * same frame three hundred times over, and a reviewer looking at a floor wants to
 * look at the floor.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op, and a still that cannot be
 * written is reported as an output that never turned up, which is a fact about
 * the host rather than about the build.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`meltdown: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or the real
// registered actions and the real pointer — and then lets the build's own rules
// run. They fix only arrangement: which tile a tower stands on, where a unit is
// placed, which key is held. Every threshold a check asserts is stated in the
// check itself, derived from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no floor, and a check
// about a tower's cooling poses no unit.

/**
 * `reset(seed)`: the title screen, a seeded generator, every declared field at
 * its title-screen value, both rosters empty and the world gate back on.
 *
 * No frame is advanced. A pose acts on the live game at the call under this
 * engine (specs/instrumentation.md), so the state is restored when this returns,
 * and a check about what `reset` restores — `simTime` among them — reads a game
 * that has run no frame since.
 */
export function resetTo(h: Harness, seed?: number): void {
  h.debug.reset(seed);
}

/** The money a run on this pair opens with (specs/modes.md). */
export function startMoneyOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  return MODE_TABLE[mode].startMoney ?? DIFFICULTY_TABLE[difficulty].money;
}

/** The lives a run on this mode opens with (specs/modes.md). */
export function startLivesOf(mode: ModeName): number {
  return MODE_TABLE[mode].startLives;
}

/**
 * A run open on an EMPTY, QUIET floor, at wave 1 of its build phase, with the
 * run's figures at what the mode and difficulty give them.
 *
 * This is the ground almost every mechanical check stands on, and it is a harness
 * sequence rather than a debug operation because the surface is atomic: every
 * line below is one of its operations.
 *
 * EMPTY is safe. A wave clears on the transition in which its last unit goes
 * (specs/waves.md), so a phase that never released one never clears, and a posed
 * rule runs without the run advancing underneath it.
 *
 * QUIET is the world gate. With `waveSpawning` off, the build timer's automatic
 * start of the next wave and the spawner's release of its units are both held, so
 * a scenario that spends more than fifteen seconds of game time — every cooling
 * scenario at a low heat, every trip cooldown, every slow expiry — is not invaded
 * by a wave. The timer still counts down and a unit already on the floor still
 * walks: the gate holds the run's own RELEASE of surge and nothing else.
 *
 * A check whose REQUIREMENT is that faculty turns it back on with
 * `h.debug.setWaveSpawning(true)`, and the list of items that do is closed. A
 * check that finds itself needing the gate for any other reason has been
 * mis-posed.
 *
 * The money and lives are computed from the case's own tables in
 * `constants.ts`, never read back off the build's snapshot: whether a build
 * reports the right `startMoney` is `modes.run-opens-with-its-figures`'s
 * requirement, and a helper that seeded from the build's own reading would fail
 * every scenario standing on that purse for a fault belonging to that one item.
 *
 * The generator is left as `reset` seeded it, so a check that wants a particular
 * seed calls {@link resetTo} first — this helper's own `reset` takes the default.
 * No frame is advanced: every pose here lands at the call.
 */
export function startRun(
  h: Harness,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  const { debug } = h;
  debug.reset();
  debug.setMode(mode);
  debug.setDifficulty(difficulty);
  debug.clearTowers();
  debug.clearSurge();
  debug.setScreen("playing");
  debug.setPhase("building");
  debug.setWave(1);
  debug.setBuildTimer(BUILD_PHASE_TIME);
  debug.setWavePending(0);
  debug.setWaveSpawning(false);
  debug.setMoney(startMoneyOf(mode, difficulty));
  debug.setLives(startLivesOf(mode));
  debug.setScore(0);
  debug.setSelected(null);
  debug.setHoverShop(null);
  debug.setArmed(null);
  debug.setSpeed(1);
}

/**
 * One tower of `type`, footprint anchored at `(col, row)`, and its id.
 *
 * The id comes off the snapshot's last tower, which is where an added tower lands
 * (specs/instrumentation.md, Identity). A build whose `addTower` added nothing
 * fails here, naming the operation.
 */
export function poseTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number {
  h.debug.addTower(type, col, row, rotation);
  const towers = h.snapshot().towers;
  if (towers.length === 0) {
    fail(
      `addTower(${JSON.stringify(type)}, ${col}, ${row}, ${rotation}) to ` +
        `append a tower to the roster (specs/instrumentation.md)`,
      "the tower roster is empty",
    );
  }
  return towers[towers.length - 1].id;
}

/**
 * A tower whose guns are held off, at a posed heat: the THERMAL-scenario atom.
 *
 * With `firingEnabled` off the tower acquires nothing and fires nothing, so no
 * shot's `heatPerShot` lands in the middle of a measurement, while its thermal
 * model runs exactly as an idle tower's does — it cools, conducts, exchanges with
 * movers, and trips.
 */
export function poseIdleTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
  heat = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerFiring(id, false);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A tower firing at a heat that cannot drift: the COMBAT-scenario atom.
 *
 * With `thermalEnabled` off the heat holds exactly where it was posed while the
 * tower goes on acquiring targets, firing at its rate, and dealing
 * `baseDamage * heatMultiplier(heat, redline)` at that pinned heat — which is how
 * a damage reading is taken without the multiplier moving under it.
 */
export function posePinnedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerThermal(id, false);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A tower that is ALREADY tripped, with its cooldown running: the trip atom.
 *
 * Every item about what a tripped tower does poses one this way rather than
 * driving one over its redline, because driving it there would make the item fail
 * whenever targeting, range, the fire clock or the per-shot heat gain is broken —
 * the entanglement the two faculty gates exist to remove. The one item whose
 * requirement is the trip EVENT (`trip/trips-at-100`) reaches it on the real path
 * instead, and so does `audio/trip-cue`.
 *
 * `timer` and `heat` are the caller's, because what a trip opens with is a figure
 * specs/heat.md fixes and the check that asserts it states it.
 */
export function poseTrippedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  timer: number,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, timer);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A stationary, effectively unkillable target with its centre on tile
 * `(col, row)`, and its id.
 *
 * Motion off, so it does not walk out of range while a reading is taken, and its
 * route is still computed from the tile it stands on. The hp is the caller's: a
 * target a damage reading is taken off wants far more hp than the shots will
 * remove, so the reading is a subtraction rather than a death.
 */
export function poseTarget(
  h: Harness,
  type: SurgeType,
  col: number,
  row: number,
  hp: number,
): number {
  const { x, y } = tileCenter(col, row);
  return poseTargetAt(h, type, x, y, hp);
}

/** {@link poseTarget} at a logical stage point rather than a tile centre. */
export function poseTargetAt(
  h: Harness,
  type: SurgeType,
  x: number,
  y: number,
  hp: number,
): number {
  const id = poseUnit(h, type, "left");
  h.debug.setUnitPosition(id, x, y);
  h.debug.setUnitMotion(id, false);
  h.debug.setUnitMaxHp(id, hp);
  h.debug.setUnitHp(id, hp);
  return id;
}

/**
 * One unit of `type` entered at `vent`, exactly as the spawner enters one, and
 * its id. Motion on, hp as its type and the wave's scaling give it.
 *
 * This is the WALKER: a check about crossing the floor, leaking, or being slowed
 * poses one of these and lets it walk.
 */
export function poseWalker(
  h: Harness,
  type: SurgeType,
  vent: VentName,
): number {
  return poseUnit(h, type, vent);
}

/** `addUnit`, with the id read off the roster it was appended to. */
function poseUnit(h: Harness, type: SurgeType, vent: VentName): number {
  h.debug.addUnit(type, vent);
  const surge = h.snapshot().surge;
  if (surge.length === 0) {
    fail(
      `addUnit(${JSON.stringify(type)}, ${JSON.stringify(vent)}) to append a ` +
        `unit to the roster (specs/instrumentation.md)`,
      "the surge roster is empty",
    );
  }
  return surge[surge.length - 1].id;
}

/**
 * A tower of each of `types` placed against the four faces of the tower `id`,
 * and their ids in the order they were given: north, east, south, west.
 *
 * The four are anchored so each shares a whole face with the centre tower and
 * none shares an edge with another — they meet each other at corners only — so
 * every edge-tile of the centre's perimeter faces a tower and sheds nothing to
 * air. That is the thermal blanket the boxed-in items are about.
 *
 * The centre tower is read off the snapshot for its anchor and its size, so this
 * works for a 2, 3 or 4 tile footprint. The four neighbours are 2x2, which every
 * type in `types` must therefore be; a caller wanting a larger neighbour places
 * it itself.
 */
export function boxIn(
  h: Harness,
  id: number,
  types: readonly [TowerType, TowerType, TowerType, TowerType],
): [number, number, number, number] {
  const centre = towerById(h.snapshot(), id);
  if (centre === undefined) {
    return fail(`a tower with id ${id} on the floor`, "no such tower");
  }
  const { col, row, size } = centre;
  const [north, east, south, west] = types;
  return [
    poseTower(h, north, col, row - sizeOf(north)),
    poseTower(h, east, col + size, row),
    poseTower(h, south, col, row + size),
    poseTower(h, west, col - sizeOf(west), row),
  ];
}

/**
 * Arm a type, hold a rotation, move the preview onto `(col, row)` and commit it —
 * the whole of what a player does to put a tower down, through the surface's own
 * atoms and its one act.
 *
 * The id of the tower `place` committed comes back, or `null` when the footprint
 * was invalid and nothing was built — which is the honest answer for a check
 * about a refused placement. The roster's length is compared across the act, so a
 * commit is told from a refusal by whether a tower arrived rather than by
 * re-reading `build.valid` after the fact.
 */
export function placeAt(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number | null {
  h.debug.setArmed(type);
  h.debug.setPreviewRotation(rotation);
  h.debug.setPreview(col, row);
  const before = h.snapshot().towers.length;
  h.debug.place();
  const towers = h.snapshot().towers;
  if (towers.length <= before) return null;
  return towers[towers.length - 1].id;
}

/* ---- Driving the real input path ------------------------------------------ */

/** An action the game registers, as `constants.ts` names them (specs/controls.md). */
export type Action = ActionName;

/**
 * The action's first bound key, from the case-fixed `BINDINGS` table, pressed and
 * released as a player would press it — the REAL registered-action path, which is
 * the only way the menus move (specs/screens.md).
 */
export async function tapAction(h: Harness, action: Action): Promise<void> {
  await h.tap(BINDINGS[action][0]);
}

/** Hold the action's first bound key down, as a player holding it would. */
export function holdAction(h: Harness, action: Action): void {
  h.hold(BINDINGS[action][0]);
}

/** Release the action's first bound key. */
export function releaseAction(h: Harness, action: Action): void {
  h.release(BINDINGS[action][0]);
}

/**
 * Hold `code` down for `frames` frames and let it up.
 *
 * The key is down for the whole of the run, so a check that measures a rate
 * measures exactly `frames` frames of it. The release is in a `finally`, so a
 * scenario that failed mid-hold does not leave the key down for the next one.
 */
export async function holdFor(
  h: Harness,
  code: string,
  frames: number,
): Promise<void> {
  h.hold(code);
  try {
    await h.advance(frames);
  } finally {
    h.release(code);
  }
}

/** {@link holdFor} against an action's first bound key. */
export function holdActionFor(
  h: Harness,
  action: Action,
  frames: number,
): Promise<void> {
  return holdFor(h, BINDINGS[action][0], frames);
}

/**
 * Move the pointer to a logical stage point and run the frame that delivers it.
 *
 * A real `pointermove` at the engine's own event target, which is the path the
 * build's preview reads through `input.pointer()` — never the debug surface's
 * `pointerMove`, so a check about what the pointer does is decided on the path a
 * player uses.
 */
export async function movePointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointermove", x, y);
  await h.advance(1);
}

/**
 * A press and a release at one logical stage point, a frame apart — one tap, as a
 * player makes it.
 *
 * The press lands, a frame runs so the build resolves it, the release lands, and a
 * frame runs so the build resolves that. Which of place, select and deselect
 * happens is the build's to decide from what is armed (specs/building.md).
 */
export async function pressAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointer("pointerdown", x, y);
  await h.advance(1);
  h.pointer("pointerup", x, y);
  await h.advance(1);
}

/** {@link pressAt} on the centre of a control the panel reported. */
export function tapControl(h: Harness, control: ControlRect): Promise<void> {
  const { x, y } = rectCenter(control);
  return pressAt(h, x, y);
}

/**
 * The rectangle the build reported for row `index` of the current screen's menu,
 * or the failure that it reported none.
 *
 * `specs/screens.md` requires every row of every menu to be a pointer target and
 * has the build report each row's rectangle, so a screen whose menu the build
 * drew but did not report cannot be driven with the pointer at all.
 */
export function menuRow(snapshot: MeltdownSnapshot, index: number): MenuRow {
  const row = snapshot.menu.find((entry) => entry.index === index);
  if (row === undefined) {
    fail(
      `snapshot().menu to hold row ${index} of the ${snapshot.screen} menu, ` +
        `one rectangle per row in row order (specs/screens.md)`,
      snapshot.menu.map((entry) => entry.index),
    );
  }
  return row;
}

/**
 * Move the pointer onto the centre of a reported menu row and run the frame that
 * delivers it.
 *
 * Hover alone: `specs/controls.md` says reaching a row and taking it are
 * separate, so this presses nothing.
 */
export async function hoverMenuRow(
  h: Harness,
  index: number,
): Promise<MenuRow> {
  const row = menuRow(h.debug.snapshot(), index);
  const at = rectCenter(row);
  await movePointerTo(h, at.x, at.y);
  return row;
}

/** {@link pressAt} on the centre of a reported menu row. */
export async function tapMenuRow(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRow(h.debug.snapshot(), index));
  await pressAt(h, at.x, at.y);
}

/** {@link pressAt} on the centre of tile `(col, row)`. */
export function pressTile(h: Harness, col: number, row: number): Promise<void> {
  const { x, y } = tileCenter(col, row);
  return pressAt(h, x, y);
}

/* -------------------------------------------------------------------------- */
/* Windows on the build's own clock                                           */
/* -------------------------------------------------------------------------- */
//
// THE RULE THESE EXIST FOR. Any check about whether time passes is measured on
// the clock the player's game actually runs on, never through the stepping
// operation, because the stepping operation is instrumentation and the question
// is about the game.
//
// Meltdown's own history is why. A pause check that paused the game and then
// stepped it measured WHERE A BUILD PUT ITS PAUSE GATE and not whether the floor
// froze: a build holding the pause in the shell that drives the clock — equally
// legal — stepped straight through the check while its real-time clip showed the
// unit stopping dead, and a build whose pause menu opened over a floor that kept
// running — the actual defect the item exists to catch — passed outright whenever
// the stepping operation happened to be gated.
//
// Under this engine `engine.advance` IS the player's frame loop running against a
// different clock object, so {@link windowOfFrames} is a legitimate reading of
// that rule. {@link windowOfRealTime} is the stronger one, and it is what the
// `waves.pause-*`, `waves.resume-*`, `waves.game-runs-on-its-own-clock` and
// `waves.speed-doubles-the-game-time` items are measured with: the loop and the
// clock go back to the build, a real window of wall-clock time passes, and
// nothing in the suite touches the game while it does.
//
// BOTH READINGS COME FROM ONE SNAPSHOT. The window's `opened` snapshot is taken
// once, after whatever act opened it, so a pair read off it — a unit's position
// and `simTime`, say — spans that window and nothing else. A check that took two
// snapshots would be comparing readings a round trip apart and could not say what
// the interval between them was.

/** One window on the build's own clock, with the snapshot on each side of it. */
export interface ClockWindow {
  /**
   * The ONE snapshot taken as the window opened, after the act that opened it.
   * Every reading of what happened during the window is measured from this.
   */
  opened: MeltdownSnapshot;
  /** The snapshot taken as the window closed. */
  closed: MeltdownSnapshot;
  /** The wall-clock milliseconds the window was left open for, `0` for a stepped one. */
  ms: number;
  /** The frames of the suite's own clock the window spanned, `0` for a real one. */
  frames: number;
}

/**
 * Run `act`, snapshot, step `frames` frames of the suite's clock, snapshot again.
 *
 * The reading a check about a rate takes: the engine's frame loop runs the
 * identical frame a player's frame runs, so what this measures is the game's own
 * advance rather than an instrument's.
 *
 * `act` is optional and runs BEFORE the opening snapshot, so a window opened by a
 * key press spans the press and nothing before it.
 */
export async function windowOfFrames(
  h: Harness,
  frames: number,
  act?: () => void | Promise<void>,
): Promise<ClockWindow> {
  if (act !== undefined) await act();
  const opened = h.snapshot();
  await h.advance(frames);
  return { opened, closed: h.snapshot(), ms: 0, frames };
}

/**
 * Run `act`, snapshot, hand the loop and a real clock back to the build for `ms`
 * of wall-clock time, snapshot again.
 *
 * Nothing steps the game across the window: {@link Harness.settle} runs the
 * build's own loop off the host's frame callback against a `WallClock`, so what
 * the game does is the game's. This is the measurement the pause items rest on,
 * and the running leg of such a pair is what stops a dead floor passing
 * vacuously.
 *
 * The window's length and every tolerance read off it belong to the CHECK: a
 * build may clamp its per-frame delta, may lose a frame to the handover, and may
 * resolve an injected key on its next frame rather than inside the call, so the
 * figures that make room for those are stated where they are asserted.
 */
export async function windowOfRealTime(
  h: Harness,
  ms: number,
  act?: () => void | Promise<void>,
): Promise<ClockWindow> {
  if (act !== undefined) await act();
  const opened = h.snapshot();
  await h.settle(ms);
  return { opened, closed: h.snapshot(), ms, frames: 0 };
}

/** One window on the build's own clock, closed on a gain rather than a stopwatch. */
export interface GainWindow extends ClockWindow {
  /** Whether the build's clock gained the seconds asked for before the deadline. */
  reached: boolean;
}

/**
 * Run `act`, snapshot, hand the loop and a real clock back to the build until ITS
 * OWN clock has gained `seconds`, snapshot again.
 *
 * THE FORM EVERY RUNNING LEG A CHECK ASSERTS ON SHOULD TAKE, and the difference
 * from {@link windowOfRealTime} is only which clock decides when the window
 * closes. Nothing steps the game either way — that is the rule, and it is what
 * makes a pause item mean anything — but a window closed by a STOPWATCH covers
 * however much game time this machine's scheduler allowed the loop to produce,
 * which on a loaded runner is a fraction of what the same build produces idle. A
 * bound read off such a window fails a conformant build for the load on the
 * runner. A window closed on `simTime` covers the stretch of the game it names on
 * any machine, and takes longer on a slow one instead of covering less.
 *
 * `ms` reports the real time it took, which is a fact about the HOST and which
 * nothing asserts on; it is there so a PAUSED window beside it — the one window
 * that cannot be closed on a gain, since the whole claim is that the clock does
 * not move — can be given the same stretch of real time.
 */
export async function windowOfClockGain(
  h: Harness,
  seconds: number,
  deadlineMs: number,
  act?: () => void | Promise<void>,
): Promise<GainWindow> {
  if (act !== undefined) await act();
  const opened = h.snapshot();
  const gained = await h.gain(seconds, deadlineMs);
  return {
    opened,
    closed: h.snapshot(),
    ms: gained.elapsedMs,
    frames: 0,
    reached: gained.reached,
  };
}

/**
 * How far the unit `id` moved across a window, in logical units, or `null` where
 * it was missing from either end of it.
 *
 * `null` rather than `0`, because a unit that left the floor and a unit that
 * stood still are different outcomes and a check that read both as `0` could not
 * tell them apart.
 */
export function travelOf(span: ClockWindow, id: number): number | null {
  const before = unitById(span.opened, id);
  const after = unitById(span.closed, id);
  if (before === undefined || after === undefined) return null;
  return distance({ x: before.x, y: before.y }, { x: after.x, y: after.y });
}

/** The game time the simulation advanced by across a window, in seconds. */
export function clockGain(span: ClockWindow): number {
  return span.closed.simTime - span.opened.simTime;
}

/**
 * How much the tower `id`'s heat changed across a window, or `null` where it was
 * missing from either end of it.
 */
export function heatGain(span: ClockWindow, id: number): number | null {
  const before = towerById(span.opened, id);
  const after = towerById(span.closed, id);
  if (before === undefined || after === undefined) return null;
  return after.heat - before.heat;
}

/* -------------------------------------------------------------------------- */
/* Reading the snapshot                                                       */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned, so a check reads what it
// is about without walking a roster by hand. None of them asserts anything: a
// reading that is not there comes back `undefined`, and what that means is the
// check's to state.

/** The tower with that id, or `undefined` where no tower carries it. */
export function towerById(
  snapshot: MeltdownSnapshot,
  id: number,
): TowerSnapshot | undefined {
  return snapshot.towers.find((tower) => tower.id === id);
}

/** The unit with that id, or `undefined` where no unit carries it. */
export function unitById(
  snapshot: MeltdownSnapshot,
  id: number,
): UnitSnapshot | undefined {
  return snapshot.surge.find((unit) => unit.id === id);
}

/** The tower whose footprint covers tile `(col, row)`, in roster order. */
export function towerOn(
  snapshot: MeltdownSnapshot,
  col: number,
  row: number,
): TowerSnapshot | undefined {
  return snapshot.towers.find(
    (tower) =>
      col >= tower.col &&
      col < tower.col + tower.size &&
      row >= tower.row &&
      row < tower.row + tower.size,
  );
}

/** Every tile every tower on the floor stands on. */
export function blockedTiles(snapshot: MeltdownSnapshot): Tile[] {
  return snapshot.towers.flatMap(tilesOf);
}

/** Every tower of `type` on the floor, in roster order. */
export function towersOfType(
  snapshot: MeltdownSnapshot,
  type: TowerType,
): TowerSnapshot[] {
  return snapshot.towers.filter((tower) => tower.type === type);
}

/** Every unit of `type` on the floor, in roster order. */
export function unitsOfType(
  snapshot: MeltdownSnapshot,
  type: SurgeType,
): UnitSnapshot[] {
  return snapshot.surge.filter((unit) => unit.type === type);
}

/** The centre of a placed tower's footprint, which is what range is measured from. */
export function centreOf(tower: TowerSnapshot): Point {
  return footprintCentre(tower.col, tower.row, tower.size);
}

/** A unit's centre, as a point. */
export function positionOf(unit: UnitSnapshot): Point {
  return { x: unit.x, y: unit.y };
}

/** The shop entry the panel drew for `type`, or `undefined` where it drew none. */
export function shopEntry(
  snapshot: MeltdownSnapshot,
  type: TowerType,
): ShopControl | undefined {
  return snapshot.controls.shop.find((entry) => entry.type === type);
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
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
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
 * The centre pixel plus four neighbours 3 units out — well inside a 19-unit tile,
 * and inside the smallest footprint a tower is drawn on — so one stray
 * anti-aliased or glow pixel cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
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

/** The rendered colour at the centre of tile `(col, row)`. */
export function sampleTile(h: Harness, col: number, row: number): Rgb {
  const { x, y } = tileCenter(col, row);
  return sampleColor(h, x, y);
}

/** The rendered colour at the centre of a placed tower's footprint. */
export function sampleTower(h: Harness, tower: TowerSnapshot): Rgb {
  const { x, y } = centreOf(tower);
  return sampleColor(h, x, y);
}

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** Every device pixel inside a logical rectangle, as `Rgb`s. */
function pixelsIn(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Rgb[] {
  const from = h.device(x, y);
  const to = h.device(x + w, y + height);
  const { data } = h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  );
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

/** The mean colour of a logical rectangle, over every device pixel in it. */
export function sampleRegion(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Rgb {
  const pixels = pixelsIn(h, x, y, w, height);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of pixels) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  return {
    r: r / pixels.length,
    g: g / pixels.length,
    b: b / pixels.length,
  };
}

/**
 * The colour of whatever is BRIGHTEST inside a logical rectangle: the mean of its
 * brightest `fraction` of pixels.
 *
 * {@link sampleRegion} reads the whole rectangle, which is the right reading for
 * a solid body — a tower footprint, the casing band, the panel strip — and the
 * wrong one for a MARK on a field: a heat read drawn as a thin bar across a
 * footprint, a health bar over a unit, a range ring. Averaging those in with the
 * ground behind them reads the ground. This reads the mark instead.
 *
 * The fraction is the caller's, because how much of a rectangle the thing being
 * read fills is a fact about what the check is looking at.
 */
export function brightestIn(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
  fraction: number,
): Rgb {
  const pixels = pixelsIn(h, x, y, w, height);
  pixels.sort((a, b) => luminance(b) - luminance(a));
  const taken = Math.max(1, Math.round(pixels.length * fraction));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < taken; i += 1) {
    r += pixels[i].r;
    g += pixels[i].g;
    b += pixels[i].b;
  }
  return { r: r / taken, g: g / taken, b: b / taken };
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same
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
 * The canvas's whole backing store, copied — so a check can hold two frames apart
 * and say whether anything the build drew changed between them.
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

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

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
 * case's own, but how a build presents it is the build's, and a readout is
 * commonly drawn with its label, a separator or padding around it. Requiring the
 * exact run would fail a panel that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * range ring asked for strictly more of these than the same frame without one,
 * whatever shape the build chose to draw it as.
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
 * Every point a frame's drawing calls named, in the space the game draws in.
 *
 * The pipeline sets the world-to-device transform on the context before a
 * component draws, so the coordinates a drawing call carries are the game's own —
 * and with the camera at its defaults those are logical units. Where a render put
 * its geometry is the direct reading of it: the points along a tile boundary are
 * the grid, and a ring of points about a footprint centre is a range ring. The
 * leading pair of arguments is the position for every method listed, except the
 * curve calls, whose control points come first and whose endpoint is the last
 * pair.
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
 * its measured width and `textAlign`. Which way a `start`/`end` alignment reads is
 * the page's direction; this game draws no right-to-left text, so they are left
 * and right.
 *
 * This is how a check tells the panel's readouts apart from the floor's: a run
 * whose `left` is past the panel's own left edge was drawn on the panel.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws it
 * through the same context, in device pixels under an identity transform, which
 * this mapping carries back to logical units like any other run.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (const call of h.calls) {
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

/** Forget every draw call recorded so far, so a check reads its own frame alone. */
export function clearCalls(h: Harness): void {
  h.calls.length = 0;
}

/**
 * Run one frame with the call list cleared first, so what comes back is that
 * frame's render and nothing before it.
 *
 * The reading almost every drawing check opens with: pose, then `renderFrame`,
 * then read `h.calls`.
 */
export async function renderFrame(h: Harness): Promise<void> {
  clearCalls(h);
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* The diagnostics overlay                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Toggle the engine's diagnostics overlay and run the frame that draws — or stops
 * drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key (`Backquote`)
 * toggles it through a keydown listener the engine itself owns on the harness's
 * event target, never through a registered action (engine docs,
 * diagnostics.md). It is drawn after the pipeline renders, through the same
 * context this harness records — so with the overlay up, the registered sources'
 * lines land in `h.calls` as ordinary text draws, readable with
 * {@link drawnText} — but AFTER the engine recorder's bracket closes, so none of
 * it appears in a `captureReplay` recording. Capture overlay evidence with
 * {@link captureStill}.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}
