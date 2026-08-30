// Refract — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
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
// same input path a player's pointer feeds, `trace` is sugar over them and is
// subject to every limit a hand-drawn trace is, and `reset` gives everything
// back. Posing through it is how a scenario is reproducible, and it is the
// seam the case's specification documents. `surface.ts` is that specification
// as types, and it is the only description of the surface this harness reads:
// the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check —
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly. The pointer operations and `trace` take
// effect the moment they are called (specs/instrumentation.md), so a whole
// route is drawn with no frame advanced between the calls — the immediacy is
// itself a specified behavior, and the suite about it advances nothing. One
// consequence is worth stating once, here: a SCREEN-CHANGING pose (`reset`,
// `startMode`, `loadBoard`) may land at the call or as late as the end of the
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
// (instrumentation/deterministic-core) builds its own harnesses with clocks of
// its own.

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
import { BINDINGS, LAYOUT, STAGE_H, STAGE_W } from "../src/constants";
import { BACKGROUND, game as build } from "../src/game";
import { assertEqual, assertTruthy, fail } from "./assert";
import { CHANNELS, cellCenter, parseBoard, type Board } from "./notation";
import { CAMPAIGN_BOARDS } from "./routes";
import type { Beams } from "./rules";
import { solve } from "./solver";
import type {
  CellRef,
  Channel,
  Mode,
  RefractDebugApi,
  RefractSnapshot,
} from "./surface";

export type { CellRef, Channel, Mode };

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

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever transform the pipeline applied, the measured
 * width under the current font, and the alignment that places the run about
 * its anchor.
 */
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
  snapshot: RefractSnapshot;
}

export interface Harness {
  readonly engine: Engine<RefractSurface>;
  /**
   * The world currently open, read fresh on every access. Refract runs in one
   * world for the whole session, but reading it through the engine keeps a
   * check honest against a build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `RefractState` specs/state.md
   * declares — read fresh on every access.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<RefractSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` — see {@link readDebugSurface} — and driven directly:
   * each operation acts on the live game at the moment of the call.
   */
  readonly debug: RefractDriver;
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
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): RefractSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: RefractSnapshot) => boolean,
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
   * The event target the surface hands the engine — where the engine's own
   * input system attached its `keydown`/`keyup` AND `pointerdown`/
   * `pointermove`/`pointerup` listeners.
   *
   * {@link hold}, {@link release} and {@link tap} are the keyboard side of it,
   * and {@link pointer} is the pointer side. It stays exposed for a check that
   * needs to raise some other event on the same target.
   */
  readonly events: EventTarget;

  /**
   * Dispatch a REAL pointer event at a logical stage point, through the
   * engine's own pointer input — the player's path, where the sample is read
   * by the next frame's update — as opposed to the debug surface's pointer
   * operations, which are immediate poses. The point is mapped through the
   * current viewport and DPR, so it names the same logical spot under any
   * surface options. Advance a frame after dispatching for the game to read
   * it.
   *
   * Two kinds of check need this rather than the poses. A cue is specified as
   * playing "on the frame its event happens, from update" (specs/ui.md), and a
   * pointer operation on the debug surface resolves at the CALL rather than
   * inside an update (specs/instrumentation.md), so a check that must pin a
   * cue's frame has to raise a real sample. And specs/controls.md phrases
   * extending and retracting about the pointer a PLAYER holds, so a check that
   * decides a held drag drives the held drag.
   */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;

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

/**
 * A `PointerEvent`-shaped event: the engine's input system reads `clientX`,
 * `clientY`, and `isPrimary`, structurally, so this drives it exactly as a
 * browser's own event does.
 */
class PointerLikeEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    clientX: number,
    clientY: number,
  ) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

/**
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates
 * coincide, which is the space every figure in `src/constants.ts` is stated
 * in — so the projection is the identity unless the build moved it, and
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
 * build whose `initialize` returned `undefined` never gets this far, because
 * the engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such
 * a build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes
 * its harness with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the real
 *   verdict under the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the
 *   missing surface and fails, by assertion, at the moment a check first reaches
 *   for an operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 */
function readDebugSurface(engine: Engine<RefractSurface>): RefractSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as RefractSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for ANY
 * member — an operation this engine's surface carries, or one a future
 * revision adds — reports the missing surface rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): RefractSurface {
  return new Proxy({} as RefractSurface, {
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
 * passes — the design size, the build's exported `BACKGROUND`, and the
 * four-way layout — so one harness serves every build of this case. Everything
 * else the build decided lives inside `src/game.ts`.
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

  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<RefractSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own bench background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
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

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
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
    assetFailures,

    snapshot: () => projectCells(debug.snapshot()),

    advance: (frames) => engine.advance(frames),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = projectCells(debug.snapshot());
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        await engine.advance(step);
        frames += step;
        snapshot = projectCells(debug.snapshot());
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

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },
    events: keys,

    pointer: (type, x, y) => {
      // The inverse of the engine's own mapping: its input system reads
      // `clientX`/`clientY` as CSS pixels from the canvas's top-left corner,
      // multiplies by the device pixel ratio, and maps through the live
      // viewport fit — so a logical point goes back out the same way, through
      // the world's camera and the fit, then divided by the ratio.
      const point = toDevice(engine.world, engine.viewport(), x, y);
      keys.dispatchEvent(
        new PointerLikeEvent(type, point.x / dpr, point.y / dpr),
      );
    },

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
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that walks half the campaign to reach a mid-course board records the
//    board, not the walk; the reviewer is not asked to scrub past the
//    arrangement to reach the seconds that decide the point.
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
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/tracing/extend.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest
 * and the runner both already agree on. Stating the prefix here is what keeps
 * that address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/<engine>/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, so a section a check drives
 * for half a minute of game time runs to tens of megabytes — a file nobody can
 * serve to a reviewer and nobody wants in a run's artifacts. The cap is what
 * makes `captureReplay` safe to wrap ANY section in: an author arms the
 * recorder around what the check is about and never has to reason about how
 * long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a segment appearing, a sweep across illegal targets, a board solving — are
 * written whole.
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
 * what these outputs are named for. A sweep is evidence that the beam grew node
 * by node, and the growth is spread across the whole of it.
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
 * check's sweep stopped at — the added segment, the solve — and it is the one a
 * reviewer looks at first.
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
    console.warn(`refract: could not write ${destination}: ${String(error)}`);
  }
}

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
 * PICTURE rather than a stretch of motion: the posed board, the refused move's
 * unchanged beam, the select grid. A recording of a still screen would be the
 * same frame three hundred times over, and a reviewer looking at a board wants
 * to look at the board.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
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
    console.warn(`refract: could not write ${destination}: ${String(error)}`);
  }
}

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
 * `reset({seed})` and the frame that lands it: the title screen, a seeded
 * generator, everything at its title-screen value. Every suite's opening move.
 */
export async function resetTo(h: Harness, seed?: number): Promise<void> {
  h.debug.reset(seed === undefined ? undefined : { seed });
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
 * Enter a mode through the surface's `startMode`, then run the one frame that
 * draws the screen it opened.
 *
 * specs/instrumentation.md defines `startMode` as entering a mode "exactly as
 * choosing its menu item does", so a check that only needs to BE in a mode
 * poses it. The title menu stays the subject of the `screens/` items, which is
 * where the binding is what is being decided.
 */
export async function poseMode(h: Harness, mode: Mode): Promise<void> {
  h.debug.startMode(mode);
  await h.advance(1);
}

/** `[col, row]` pairs — the shape `routes.ts` stores — as `trace` cells. */
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
 * From a fresh title, choose CAMPAIGN the way a player does: `confirm` on the
 * title menu's first item. Lands on `select` with a fresh course.
 */
export async function startCampaign(h: Harness, seed?: number): Promise<void> {
  await resetTo(h, seed);
  await tapAction(h, "confirm");
  await h.advance(1);
}

/**
 * From a fresh title, choose CASCADE the way a player does: `down` to the
 * second item, then `confirm`. Lands on `playing` with the first generated
 * board.
 */
export async function startCascade(h: Harness, seed?: number): Promise<void> {
  await resetTo(h, seed);
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  await h.advance(1);
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
    h.debug.trace(toCells(route));
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
  seed?: number,
): Promise<RefractSnapshot[]> {
  await startCampaign(h, seed);
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
    h.debug.trace(cells);
  }
}

/** One cascade board a `solveGenerated` sweep met and solved. */
export interface SolvedGenerated {
  /** The snapshot taken when the board arrived on `playing`. */
  arrival: RefractSnapshot;
  /** The arrived board, in the oracle's shape. */
  board: Board;
  /** The solving beams the spec-derived solver found for it. */
  beams: Beams;
}

/**
 * Start a seeded cascade run and REALLY solve `k` generated boards in a row:
 * for each, read the arrived board off the snapshot, solve it with the
 * spec-derived solver, trace the found beams, assert the build agrees it is
 * solved, and take the solved screen's first choice, NEXT BOARD, to the next.
 *
 * Entry is `reset({seed})` then `startMode("cascade")` — the checklist's
 * stated recipe for a run from a clean progression — so the sequence is a
 * function of the seed alone and two runs of one seed meet the same boards.
 *
 * A generated board the solver reports unsolvable fails the check outright:
 * the generator's contract is that every emitted board is solvable
 * (specs/modes/cascade.md). A board that only blows the expansion cap is the
 * documented residual risk — a conformant generator could in principle emit a
 * board the search cannot crack inside the cap — and it fails with a message
 * that names the cap so the verdict is read for what it is. Boards of this
 * size resolve in milliseconds in practice.
 *
 * After the call the game sits on the `solved` screen of the k-th board.
 */
export async function solveGenerated(
  h: Harness,
  k: number,
  seed: number,
): Promise<SolvedGenerated[]> {
  h.debug.reset({ seed });
  await h.advance(1);
  h.debug.startMode("cascade");
  await h.advance(1);

  const solvedBoards: SolvedGenerated[] = [];
  for (let count = 0; count < k; count += 1) {
    const arrival = h.snapshot();
    assertEqual(
      arrival.screen,
      "playing",
      `cascade board ${count + 1} opens on playing`,
    );
    const board = boardFromSnapshot(arrival);
    const result = solve(board);
    if (result.status === "unsolvable") {
      fail(
        `a solvable generated board (specs/modes/cascade.md: every board ` +
          `the generator emits is solvable)`,
        `cascade board ${count + 1} is unsolvable: ${result.reason ?? "no beam set satisfies the rules"}`,
      );
    }
    if (result.status === "limit") {
      fail(
        `a generated board the spec-derived solver can crack within its ` +
          `expansion cap (a documented residual risk of the cap, not proof ` +
          `of an unsolvable board)`,
        `cascade board ${count + 1} exhausted ${result.expansions} expansions`,
      );
    }
    traceBeams(h, result.beams);
    assertEqual(
      h.snapshot().solved,
      true,
      `cascade board ${count + 1} solved by the solver's beams`,
    );
    solvedBoards.push({ arrival, board, beams: result.beams });
    await h.advance(1);
    if (count < k - 1) {
      // The solved screen's first item is NEXT BOARD (specs/modes/cascade.md).
      await tapAction(h, "confirm");
    }
  }
  return solvedBoards;
}

/* ---- Reading the rendered pixels ------------------------------------------ */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 px out — all well inside `NODE_R`
 * (30) of a sampled node's centre — so one stray anti-aliased or glow pixel
 * cannot swing the reading.
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

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
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
export const BACKGROUND_POINTS: readonly { x: number; y: number }[] = [
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
 */
export function sampleBackground(h: Harness): Rgb {
  const clear = clearColor();
  const samples = BACKGROUND_POINTS.map((point) =>
    sampleColor(h, point.x, point.y),
  );
  return samples.reduce((barest, sample) =>
    colorDistance(sample, clear) < colorDistance(barest, clear)
      ? sample
      : barest,
  );
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the
 * same canvas implementation the harness samples with, so a pixel the game
 * never drew over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads
 * as the engine leaves it: the engine composites its clear over the previous
 * frame every frame, which converges on the colour's own channels, and a single
 * fill over a transparent canvas would not.
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

/* ---- Reading one frame's text draws ---------------------------------------- */

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame spelled `text` inside some logical run of text, ignoring
 * case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 *
 * Read off {@link drawnTextLines} rather than off the raw calls, so a heading
 * letter-spaced a glyph per `fillText` is found by the words it spells. Every
 * raw string is a substring of the run it belongs to, so coalescing can only
 * add a match and never take one away.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnTextLines(calls).some((line) =>
    line.toLowerCase().includes(wanted),
  );
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
 * drawing applies and align it any way it likes, so the anchor is mapped
 * through the transform the context held at the call and the run is extended
 * about it by its measured width and `textAlign`. Which way a `start`/`end`
 * alignment reads is the page's direction; this game draws no right-to-left
 * text, so they are left and right.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws
 * it through the same context, in device pixels under an identity transform,
 * which this mapping carries back to logical units like any other run.
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

/* ---- Logical runs of text -------------------------------------------------- */
//
// A build that letter-spaces a heading draws a glyph per `fillText`, which is
// the only portable way to letter-space canvas text: the property canvas
// exposes for it is not portable, so the ordinary implementation walks the
// string. specs/ui.md fixes the COPY a screen shows; "Palettes, fonts, layouts,
// and styling are the build's choices" makes the spacing between its glyphs the
// build's. So a check that asserts copy reads it off the logical RUN the frame
// spells, never off the `fillText` split that spelled it.
//
// THE MERGE RULE. A draw joins the run before it when the two share a baseline
// and sit side by side: `|Δbaseline| <= 0.75` device px, the later draw's left
// edge at or after the run's right edge less `0.5` px, and the gap between them
// at most `0.6 * meanAdvance` of the run so far, where `meanAdvance` is its
// measured width over its character count. A run's measured width is the extent
// it occupies, right minus left, so its mean advance carries whatever letter
// spacing its own glyphs were set at: a heading tracked wider than 0.6 of a bare
// glyph still reads as one run, while a HUD figure a clear gap from its label
// stays its own. Texts are concatenated verbatim, so a run drawn a glyph at a
// time comes back as the string it spells, tracked spaces included. The comparison is RELATIVE, so it is decided in device
// space, where the calls were made, and no viewport conversion is needed to
// decide it; {@link drawnTextRuns} converts the merged run afterwards with the
// arithmetic {@link drawnTextSpans} already uses.
//
// WHAT STAYS RAW. {@link drawnText} and {@link drawnTextSpans} are untouched.
// The overlay check diffs line SETS off `drawnText` and must not see merged
// text, and the readout-geometry checks need each draw's own extent: a merged
// span is wider than any of its members, so holding one clear of a region asks
// a different question. Every reader opts in.

/** How far apart two draws' baselines may sit and still read as one run. */
const RUN_BASELINE_SLACK = 0.75;

/** How far a draw may sit back inside the run before it and still join it. */
const RUN_BACKTRACK_SLACK = 0.5;

/** The share of the run's mean advance a gap may reach and still join it. */
const RUN_GAP_RATIO = 0.6;

/**
 * One run of text, measured where the calls were made: device pixels.
 *
 * `chars` accumulates as draws join, so the run's mean advance — its extent over
 * `chars` — is the distance its glyphs really advanced by.
 */
interface DeviceRun {
  text: string;
  baseline: number;
  left: number;
  right: number;
  chars: number;
  /** The alignment of the run's FIRST draw, which places it about its anchor. */
  textAlign: string;
}

/**
 * Where one text call landed, in device pixels, or `null` when it drew no text.
 *
 * A call whose anchor is not a pair of numbers placed nothing on the canvas. It
 * still comes back, with no place, so the copy it spells is read; it can never
 * join a run, because every comparison against `NaN` is false.
 */
function deviceDraw(call: DrawCall): DeviceRun | null {
  if (call.kind !== "call" || call.text === undefined) return null;
  const [text, ax, ay] = call.args;
  if (typeof text !== "string" || text.length === 0) return null;
  const { transform: m, width, textAlign } = call.text;
  const scaled = width * Math.hypot(m.a, m.b);
  const run: DeviceRun = {
    text,
    baseline: NaN,
    left: NaN,
    right: NaN,
    chars: text.length,
    textAlign,
  };
  if (typeof ax !== "number" || typeof ay !== "number") return run;
  const before =
    textAlign === "center"
      ? scaled / 2
      : textAlign === "right" || textAlign === "end"
        ? scaled
        : 0;
  run.baseline = m.b * ax + m.d * ay + m.f;
  run.left = m.a * ax + m.c * ay + m.e - before;
  run.right = run.left + scaled;
  return run;
}

/** Whether `next` continues `open` under the merge rule stated above. */
function joinsRun(open: DeviceRun, next: DeviceRun): boolean {
  if (Math.abs(next.baseline - open.baseline) > RUN_BASELINE_SLACK)
    return false;
  if (!(next.left >= open.right - RUN_BACKTRACK_SLACK)) return false;
  const meanAdvance = (open.right - open.left) / open.chars;
  return next.left - open.right <= RUN_GAP_RATIO * meanAdvance;
}

/**
 * The frame's text draws coalesced into logical runs, in device pixels.
 *
 * A PARTITION: every text draw belongs to exactly one run, so a heading drawn
 * `1 OF 24 SOLVED` a glyph at a time yields one run and no stray run equal to
 * `"2"`. The placed draws come back in reading order — down the frame, then
 * across it — because that is the order the merge walks them in; the unplaced
 * ones follow.
 */
function deviceRuns(calls: readonly DrawCall[]): DeviceRun[] {
  const placed: DeviceRun[] = [];
  const unplaced: DeviceRun[] = [];
  for (const call of calls) {
    const draw = deviceDraw(call);
    if (draw === null) continue;
    (Number.isFinite(draw.left) ? placed : unplaced).push(draw);
  }
  placed.sort((a, b) => a.baseline - b.baseline || a.left - b.left);

  const runs: DeviceRun[] = [];
  for (const draw of placed) {
    const open = runs[runs.length - 1];
    if (open !== undefined && joinsRun(open, draw)) {
      open.text += draw.text;
      open.right = Math.max(open.right, draw.right);
      open.chars += draw.chars;
      continue;
    }
    runs.push({ ...draw });
  }
  return [...runs, ...unplaced];
}

/** Every logical run of text the frame spelled, as the strings it spells. */
export function drawnTextLines(calls: readonly DrawCall[]): string[] {
  return deviceRuns(calls).map((run) => run.text);
}

/**
 * Every logical run of text the frame spelled, placed in logical units.
 *
 * The placed companion to {@link drawnTextLines}, and the reader a check uses
 * when it needs both the copy and where it sits — a board's number on the
 * select grid, a HUD label and the figure beside it. A run's anchor is derived
 * back from its merged extent under its first draw's alignment, so a run of one
 * draw comes back exactly as {@link drawnTextSpans} reports it.
 *
 * A draw that named no place is left out: it has copy but no geometry, and
 * {@link drawnTextLines} is where its copy is read.
 */
export function drawnTextRuns(h: Harness): TextSpan[] {
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (const run of deviceRuns(h.calls)) {
    if (!Number.isFinite(run.left) || !Number.isFinite(run.baseline)) continue;
    const left = (run.left - view.offsetX) / view.scale;
    const right = (run.right - view.offsetX) / view.scale;
    const y = (run.baseline - view.offsetY) / view.scale;
    const width = right - left;
    const before =
      run.textAlign === "center"
        ? width / 2
        : run.textAlign === "right" || run.textAlign === "end"
          ? width
          : 0;
    spans.push({ text: run.text, x: left + before, y, left, right });
  }
  return spans;
}

/* ---- The cues -------------------------------------------------------------- */

/** Every recorded firing of the cue named `name`, oldest first. */
export function cuesNamed(h: Harness, name: string): PlayedCue[] {
  return h.cues.filter((cue) => cue.cue === name);
}

/** Forget every cue recorded so far, so a check reads its own section alone. */
export function clearCues(h: Harness): void {
  h.cues.length = 0;
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
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}
