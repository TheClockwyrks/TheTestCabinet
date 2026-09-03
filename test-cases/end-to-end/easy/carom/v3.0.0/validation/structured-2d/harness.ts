// Carom — the shared validator harness. CASE-PROVIDED.
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
// tagged actors — the engine's frame counter, the events the engine broadcast,
// and — for the rendering checks — the pixels on the canvas or the calls the 2D
// context received. Nothing here fabricates an outcome: the scenario helpers
// below only ARRANGE the world through the debug surface, and the real ticks
// the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `startMatch`
// opens on the pre-serve countdown, a control op takes the paddles from the
// player and the AI, a posed `vy` persists across frames, and `reset` gives
// everything back. Posing through it is how a scenario is reproducible, and it
// is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check —
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly. Each operation is a method that acts on
// the live world at the moment of the call — the instance holds the engine, and
// `engine.world` follows transitions — so a pose is `h.debug.serve()` and a
// reading is `h.debug.snapshot()`, with nothing in between. One consequence is
// worth stating once, here: a SCREEN-CHANGING pose (`startMatch`, a `reset`
// away from the title) may land at the call or as late as the end of the next
// advanced frame — the spec fixes the arrangement, not the moment, and both
// designs are conformant — so a scenario poses, advances a frame, and then
// reads, which is correct under either design. The scenario helpers below
// carry those advances so a check does not have to.
//
// THE CLOCK. `ConstantClock(TICK_MS)` is the default, so one frame is one
// 120 Hz tick and every duration below is a whole number of them, which is the
// unit a suite's frame-counted tolerance is stated in. A check that is
// specifically about the step size (gameplay/delta-time-independent) builds its
// own harnesses with clocks of its own.

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
  type PathSegment,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@test-cabinet/structured-2d";
import {
  BALL_R,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  LAYOUT,
  P1_X1,
  P2_X0,
} from "./constants";
import { BACKGROUND, game as build } from "../src/game";
import { assertEqual, assertNotEqual, assertTruthy, fail } from "./assert";
import type {
  BallSnapshot,
  CaromDebugApi,
  CaromSnapshot,
  Mode,
  Side,
} from "./surface";

export type { Mode, Side };

/** The case's surface, exactly as `surface.ts` specifies it. */
export type CaromSurface = CaromDebugApi;

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
export type CaromDriver = CaromSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<CaromSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<CaromSurface>;

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the case's own `validation/constants.ts` deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so
 * a tolerance can be stated in ticks and mean the same thing on every machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** A speed in px/s from a displacement measured over `ticks` frames. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/** The angle from horizontal of a velocity, in degrees, ignoring direction. */
export function angleDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(Math.abs(v.vy), Math.abs(v.vx)) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* The balls                                                                  */
/* -------------------------------------------------------------------------- */

/** One ball, as a snapshot reports it. */
export type BallView = BallSnapshot;

/**
 * The ball every shared scenario drives: the only one under `base` and `gyre`,
 * and the first of the three under `multi`.
 *
 * The variants agree about what a ball IS and disagree only about how many there
 * are, so a check about the ball — its bounce, its spin, its speed off a paddle —
 * is the same check under all three, driven against ball zero. What makes that
 * sound under `multi` is {@link parkSpares}, which puts the other two balls out
 * of the scenario before it is posed, so the reading is of the driven ball alone.
 *
 * `CaromSnapshot` declares both shapes as optional, because which one a build
 * reports is its variant's to decide. A build reporting neither fails by
 * assertion here rather than throwing a `TypeError` several frames later, so the
 * point names the fault.
 */
export function ball0(snapshot: CaromSnapshot): BallView {
  const one = snapshot.ball ?? snapshot.balls?.[0];
  assertTruthy(
    one,
    "snapshot() must report the ball as `ball` (base, gyre) or the balls as " +
      "`balls` (multi); see specs/instrumentation.md",
  );
  return one as BallView;
}

/** Every ball a snapshot reports, in play order. */
export function allBalls(snapshot: CaromSnapshot): BallView[] {
  if (snapshot.balls !== undefined) return snapshot.balls;
  return snapshot.ball === undefined ? [] : [snapshot.ball];
}

/* -------------------------------------------------------------------------- */
/* Readings off the open world's game state                                   */
/* -------------------------------------------------------------------------- */
//
// The game's state lives in the framework objects the engine owns
// (specs/state.md), and its arrangement is the build's — EXCEPT where the
// specification itself names a field of `state`. specs/ui.md and specs/balls.md
// state their rules against `state.menuIndex`, `state.resumeScreen`,
// `state.receiver`, and `state.holdTimer`, so those four are readable off
// `world.state` of the open world in every conformant build, and the helpers
// below are that reading. Each asserts the field's presence with the spec that
// names it, so a build that kept the value elsewhere fails on the naming rather
// than on a `TypeError` downstream.
//
// (`receiver` and a single match-wide `holdTimer` belong to the one-ball
// variants alone: under `multi` each ball carries its own hold and no receiver
// exists, and no field of `state` is fixed for them — a multi check reads a
// ball's `held` flag through `snapshot()` instead.)

/** The open world's game state, read loosely for the spec-named fields. */
function stateRecord(h: Harness): Record<string, unknown> {
  return h.state as unknown as Record<string, unknown>;
}

/** The highlighted menu item, read off the open world's game state. */
export function menuIndex0(h: Harness): number {
  const value = stateRecord(h).menuIndex;
  assertEqual(
    typeof value,
    "number",
    "the open world's game state must hold the highlighted item as " +
      "`menuIndex`; see specs/ui.md",
  );
  return value as number;
}

/** The screen the pause menu resumes to, read off the game state. */
export function resumeScreen0(h: Harness): string {
  const value = stateRecord(h).resumeScreen;
  assertEqual(
    typeof value,
    "string",
    "the match's game state must hold the screen the pause menu resumes to " +
      "as `resumeScreen`; see specs/ui.md",
  );
  return value as string;
}

/**
 * The side the next serve travels toward: `base` and `gyre` only, where
 * specs/balls.md states the serve against `state.receiver`.
 */
export function receiver0(h: Harness): Side {
  const value = stateRecord(h).receiver;
  assertNotEqual(
    value,
    undefined,
    "the match's game state must hold the next serve's side as `receiver`; " +
      "see specs/balls.md",
  );
  return value as Side;
}

/**
 * Seconds remaining of the pre-serve hold: `base` and `gyre` only, where
 * specs/balls.md counts the one match-wide `state.holdTimer` down. Under
 * `multi` each ball carries a hold of its own and no field of `state` is
 * fixed for it, so a multi check reads the driven ball's `held` flag through
 * `snapshot()` instead of coming here.
 */
export function holdTimer0(h: Harness): number {
  const value = stateRecord(h).holdTimer;
  assertEqual(
    typeof value,
    "number",
    "the match's game state must hold the pre-serve hold as `holdTimer`; " +
      "see specs/balls.md",
  );
  return value as number;
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
  /** The element's laid-out CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical field height. */
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
  snapshot: CaromSnapshot;
}

export interface Harness {
  readonly engine: Engine<CaromSurface>;
  /**
   * The world currently open, read fresh on every access. A level transition
   * REBUILDS the world, so nothing here holds one across a frame: a check that
   * travels asks again.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. Its arrangement
   * is the build's (specs/state.md); the spec-named fields on it are read
   * through {@link menuIndex0} and its siblings.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<CaromSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` — see {@link readDebugSurface} — and driven directly:
   * each operation acts on the live world at the moment of the call.
   */
  readonly debug: CaromDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that picture
   * exists is here.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): CaromSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: CaromSnapshot) => boolean,
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
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates
 * coincide, which is the space every figure the specification fixes is stated
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
 * merits, and `instrumentation/debug-api` names the missing surface outright.
 */
function readDebugSurface(engine: Engine<CaromSurface>): CaromSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as CaromSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, because the surface is not a closed
 * list — the gyre variant adds `setObstacleClock` and `snapshot().obstacles`, and
 * a stub written against the common surface would report a gyre-only operation as
 * merely absent rather than as the consequence of the build's missing surface.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): CaromSurface {
  return new Proxy({} as CaromSurface, {
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
 * passes — the design size, the build's exported `BACKGROUND`, and the touch
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
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

  const engine = createEngine<CaromSurface>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    // The build's own field background, handed to the engine exactly as the
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

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),

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

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
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
//    check that poses a ball in front of a paddle and then plays out the contact
//    records the contact; the pose costs nothing, and the reviewer is not asked to
//    scrub past a minute of arrangement to reach the two seconds that decide the
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
 * `validation/gameplay/serve-speed.test.ts` — because that is the path the review
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
 * couple of hundred operations, so a section a check drives for half a minute of
 * game time runs to tens of megabytes — a file nobody can serve to a reviewer and
 * nobody wants in a run's artifacts. The cap is what makes `captureReplay` safe to
 * wrap ANY section in: an author arms the recorder around what the check is about
 * and never has to reason about how long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a paddle contact, a bank shot, a point played out — are written whole.
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
 * what these outputs are named for. A rally is evidence that the ball accelerated
 * hit after hit, and the hits are spread across the whole of it.
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
 * check's sweep stopped at — the contact, the point, the rebound — and it is the
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
 * stores about eight times smaller compressed. That is what keeps a run's whole
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
    console.warn(`carom: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const point = await captureReplay(harness, "goal", () => driveGoal(harness));
 * assertEqual(point.hit, true);
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
 * colour it drew a paddle, where the letterbox bars fell. A recording of a still
 * screen would be the same frame three hundred times over, and a reviewer looking
 * at a menu wants to look at the menu.
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
    console.warn(`carom: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. They fix only geometry: where a ball or a paddle is put. Every
// threshold a check asserts is stated in the check itself, derived from the
// figure or rule specs/ states for it.

/** Off-lane parking height for a paddle a scenario must keep out of the way. */
export const PARKED_CY = 150;

/** The lane down the middle of the field that clears both obstacles. */
export const CLEAR_LANE_Y = FIELD_CY;

/**
 * How far in front of a paddle contact the ball is posed, in frames of approach.
 *
 * The contact itself is the same one a zero-lead pose makes immediately; the
 * run-up buys the scenario a real approach, and — because a posed `vy` persists —
 * it is also what lets a SWINGING paddle be moving at the moment it strikes,
 * having travelled the same distance the ball did.
 */
export const LEAD_TICKS = 60; // 0.5 s at 120 Hz

/**
 * Park both paddles out of the mid-field lane so a shot down it is unobstructed,
 * and hold the obstacles upright.
 *
 * Under `gyre` the obstacles sway and turn with a clock that runs during the
 * countdown, so by the time a scenario is posed they are a fraction of a degree
 * off upright. `setObstacleClock(0)` puts them at their base centres, upright,
 * and holds them there (specs/instrumentation.md), which is the pose at which
 * gyre's oriented rule "reduces to the upright case" (specs/playfield.md) and a
 * shared check about an obstacle face means the same thing in every variant.
 * The operation is gyre's alone; the other variants' obstacles never move.
 */
export function clearPaddles(h: Harness): void {
  h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: PARKED_CY, vy: 0 });
  h.debug.setObstacleClock?.(0);
}

/**
 * Where a scenario parks the balls it is not about, in logical units.
 *
 * `multi` puts three balls on the field and every shared check is about one of
 * them, so the other two are moved off the scenario before it is posed. These are
 * the two corners of the LEFT goal channel: inside the field, so a parked ball
 * scores nothing; behind the left paddle and clear of its x range at every
 * height, so it is never struck; and hard against two walls, which is the one
 * part of the field a driven ball does not cross. The shared scenarios aim down
 * the mid-field lane at `FIELD_CY`, at a paddle face, or at an obstacle, and the
 * one thing any of them sends past a goal edge leaves by the RIGHT one.
 *
 * A scenario that does drive a ball out of the left goal passes its own pair to
 * {@link parkSpares} instead; see `multi/harness.ts`.
 */
export const SPARE_PARKS: readonly { x: number; y: number }[] = [
  { x: BALL_R + 2, y: BALL_R + 2 },
  { x: BALL_R + 2, y: FIELD_H - BALL_R - 2 },
];

/**
 * Take every ball but the first out of the scenario, and report how many there
 * were.
 *
 * Under `base` and `gyre` there is one ball and this does nothing. Under `multi`
 * it poses balls one and two at {@link SPARE_PARKS}, motionless and spinless,
 * which `specs/instrumentation.md` says of `setBall` is what takes a ball into
 * live play and out of its hold — so they neither launch nor move again, and the
 * check that follows reads a field with one moving ball on it, exactly as it does
 * under the other two variants.
 */
export function parkSpares(
  h: Harness,
  parks: readonly { x: number; y: number }[] = SPARE_PARKS,
): number {
  const balls = allBalls(h.snapshot());
  for (let index = 1; index < balls.length; index += 1) {
    const park = parks[(index - 1) % parks.length];
    h.debug.setBall(index, { ...park, vx: 0, vy: 0, spin: 0 });
  }
  return balls.length;
}

/**
 * Open a driven match, put every ball but the first out of the way, and run it up
 * to live play.
 *
 * The transitions are advanced through here so a caller never counts them:
 * `reset` away from the title and `startMatch` each land no later than the end
 * of the frame after the call (the harness header), so each is followed by one
 * advanced frame, and every pose after that acts on the live match world the
 * countdown is running in.
 *
 * `serve()` only expires the pre-serve hold; the LAUNCH is the build's own, on
 * the frame after. So this sweeps until the game reports live play, which is the
 * state every posed scenario below assumes — posing a ball while the game is
 * still counting down would have the build's serve overwrite the pose.
 *
 * The spares are parked between the match opening and the hold expiring, so under
 * `multi` the one ball that launches is the one the scenario is about.
 *
 * Under `gyre` the obstacle clock is posed at `0` before the hold expires, so a
 * scenario opens on upright obstacles at their base centres rather than on
 * whatever fraction of a turn the countdown's frames happened to run; see
 * {@link clearPaddles}. The operation is gyre's alone.
 */
export async function startPlaying(
  h: Harness,
  mode: Mode = "versus",
): Promise<UntilResult> {
  h.debug.reset();
  await h.advance(1);
  h.debug.startMatch(mode);
  await h.advance(1);
  parkSpares(h);
  h.debug.setObstacleClock?.(0);
  h.debug.serve();
  return h.until((s) => s.screen === "playing", { maxFrames: 60, poll: 1 });
}

/**
 * Start a match from the title the way a player does: menu keys only.
 *
 * `reset` from a match world may land as late as the end of the next advanced
 * frame (the harness header), so one frame is advanced before the first tap —
 * otherwise that tap's edge could be consumed by the world the reset is
 * leaving.
 */
export async function startWithKeys(h: Harness, mode: Mode): Promise<void> {
  h.debug.reset();
  await h.advance(1);
  // SOLO is the first entry; VERSUS is one down.
  if (mode === "versus") await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Open a match on its pre-serve countdown through the debug surface alone:
 * `reset` to a clean title, `startMatch` onto the countdown, nothing else. This
 * is how a countdown scenario reaches its ground without driving the menus — a
 * build with a broken menu and a working countdown must fail the navigation
 * checks and pass the countdown ones. Because `startMatch` is a posing
 * operation, the opened match's paddles belong to the debug driver: a scenario
 * about the real input pipeline enters with {@link startWithKeys} instead, and
 * one that needs the hold already expired opens with {@link startPlaying}.
 *
 * Both operations may land as late as the end of the next advanced frame (see
 * the harness header), so each is followed by one frame — the countdown is
 * open, and reads, when this returns.
 */
export async function openCountdown(h: Harness, mode: Mode): Promise<void> {
  h.debug.reset();
  await h.advance(1);
  h.debug.startMatch(mode);
  await h.advance(1);
}

/* ---- Goals --------------------------------------------------------------- */

/**
 * Aim the ball at one goal edge, down the lane that clears both obstacles.
 * `edge` is the edge the ball exits: "right" scores for player one, "left" for
 * player two.
 */
export function arrangeGoal(h: Harness, edge: Side): void {
  clearPaddles(h);
  h.debug.setBall(0, {
    x: FIELD_CX,
    y: CLEAR_LANE_Y,
    vx: edge === "right" ? 600 : -600,
    vy: 0,
    spin: 0,
  });
}

/**
 * Run the real physics until the point resolves — a scored point returns to the
 * countdown, a match point to the match-over screen — and report that instant.
 */
export function driveGoal(
  h: Harness,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((s) => s.screen !== "playing", {
    maxFrames: options.maxFrames ?? 360,
    poll: options.poll ?? 6,
  });
}

/* ---- Paddle contact ------------------------------------------------------ */

/** Where a ball is posed to sit just off a paddle's front face. */
export function nearBallX(side: Side): number {
  return side === "left" ? P1_X1 + BALL_R + 10 : P2_X0 - BALL_R - 10;
}

export interface PaddleHitOptions {
  /** Where the struck paddle is when the ball arrives. */
  cy?: number;
  /** The velocity it holds through the run-up and the contact, in px/s. */
  vy?: number;
  /** The height the ball arrives at. */
  ballY?: number;
  /** How fast the ball approaches, in px/s. */
  approachSpeed?: number;
  /** An explicit start x, for a contact whose paddle must not be led upstream. */
  startX?: number;
  /** Frames of approach posed in front of the contact. */
  leadTicks?: number;
}

/**
 * Pose a contact on `side`: that paddle at `cy` moving at `vy`, the other parked,
 * and a ball aimed straight at the struck paddle's front face at `ballY`.
 *
 * With a lead, the paddle starts the run-up's worth of travel UPSTREAM so it
 * arrives at `cy` as the ball does — which is what lets a swinging paddle really
 * be moving at contact rather than pinned against a bound.
 */
export function arrangePaddleHit(
  h: Harness,
  side: Side,
  options: PaddleHitOptions = {},
): void {
  const {
    cy = FIELD_CY,
    vy = 0,
    ballY = FIELD_CY,
    approachSpeed = 400,
    startX,
    leadTicks = 0,
  } = options;

  const other: Side = side === "left" ? "right" : "left";
  const lead = seconds(leadTicks);
  h.debug.setPaddle(side, { cy: cy - vy * lead, vy });
  h.debug.setPaddle(other, { cy: PARKED_CY, vy: 0 });

  const near = nearBallX(side);
  const runUp = approachSpeed * lead;
  const x = startX ?? (side === "left" ? near + runUp : near - runUp);
  h.debug.setBall(0, {
    x,
    y: ballY,
    vx: side === "left" ? -approachSpeed : approachSpeed,
    vy: 0,
    spin: 0,
  });
}

export interface PaddleHitResult {
  hit: boolean;
  ball: BallView;
  /** The struck paddle, at the instant of the rebound. */
  paddle: { cy: number; vy: number };
  snapshot: CaromSnapshot;
}

/**
 * Run the real simulation until the ball comes off `side`'s front face, and
 * report the ball the instant it rebounds — before spin decays or curves the
 * flight. Sampled every frame, because the instant is what is read.
 */
export async function drivePaddleHit(
  h: Harness,
  side: Side,
  options: { maxFrames?: number; leadTicks?: number } = {},
): Promise<PaddleHitResult> {
  const maxFrames = (options.maxFrames ?? 72) + (options.leadTicks ?? 0);
  const rebounded =
    side === "left"
      ? (s: CaromSnapshot): boolean => ball0(s).vx > 0
      : (s: CaromSnapshot): boolean => ball0(s).vx < 0;
  const swept = await h.until(rebounded, { maxFrames, poll: 1 });
  return {
    hit: swept.hit,
    ball: ball0(swept.snapshot),
    paddle: swept.snapshot.paddles[side],
    snapshot: swept.snapshot,
  };
}

/* ---- Rally speed --------------------------------------------------------- */

/** Two still, centred paddles and a ball launched level down the middle. */
export async function arrangeRally(h: Harness): Promise<void> {
  await startPlaying(h);
  h.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: FIELD_CY, vy: 0 });
  h.debug.setBall(0, {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: -500,
    vy: 0,
    spin: 0,
  });
}

/**
 * Play a real rally and report the ball's speed after each successive paddle
 * hit. Speed is constant between hits, so each leg sweeps coarsely until the
 * horizontal direction reverses. Stops early if play ever leaves the field.
 */
export async function driveRallySpeeds(
  h: Harness,
  hits = 24,
): Promise<number[]> {
  const speeds: number[] = [];
  let previousSign = -1; // the ball is launched toward the left paddle

  for (let hit = 0; hit < hits; hit += 1) {
    const sign = Math.sign(ball0(h.snapshot()).vx);
    if (sign !== 0) previousSign = sign;
    const want = -previousSign;

    let leftPlay = false;
    const leg = await h.until(
      (s) => {
        if (s.screen !== "playing") {
          leftPlay = true;
          return true;
        }
        const ball = ball0(s);
        return Math.sign(ball.vx) === want && ball.vx !== 0;
      },
      { maxFrames: 600, poll: 6 },
    );
    if (leftPlay || !leg.hit) break;
    speeds.push(ball0(leg.snapshot).speed);
    previousSign = want;
  }
  return speeds;
}

/* ---- Held movement ------------------------------------------------------- */

export interface MoveResult {
  start: number;
  end: number;
  /** The struck paddle's Δcy: negative is upward. */
  delta: number;
  /** Each paddle's Δcy, so a check can also confirm the other stayed still. */
  otherDelta: { left: number; right: number };
}

/**
 * Hold a movement key for `ticks` frames and report how far each paddle moved.
 * Nothing here calls a control op, so the game stays under normal player control
 * and the paddles respond exactly as they do for a player.
 */
export async function holdMove(
  h: Harness,
  side: Side,
  code: string,
  options: { ticks?: number } = {},
): Promise<MoveResult> {
  const ticks = options.ticks ?? 36; // 0.3 s
  const before = h.snapshot().paddles;
  h.hold(code);
  await h.advance(ticks);
  const after = h.snapshot().paddles;
  h.release(code);

  const moved = (which: Side): number => after[which].cy - before[which].cy;
  return {
    start: before[side].cy,
    end: after[side].cy,
    delta: moved(side),
    otherDelta: { left: moved("left"), right: moved("right") },
  };
}

/* ---- The Solo AI --------------------------------------------------------- */

/**
 * A live Solo match with the human paddle parked, ball 0 posed by `ball`, the AI
 * paddle started at `paddleCy`, and the AI handed control of it. Running time
 * forward from here pits the real opponent against the posed shot.
 */
export async function arrangeAiScenario(
  h: Harness,
  scenario: {
    paddleCy: number;
    ball: { x: number; y: number; vx: number; vy?: number };
  },
): Promise<void> {
  await startPlaying(h, "solo");
  h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: scenario.paddleCy, vy: 0 });
  h.debug.setBall(0, { vy: 0, spin: 0, ...scenario.ball });
  h.debug.setAiControl(true);
}

export type AiOutcome = "blocked" | "scored" | "timeout";

/**
 * Run the posed Solo shot to its resolution.
 *
 * "blocked" — the AI reached the ball and sent it back. "scored" — the shot got
 * past it and player one's score went up. The ball must be SEEN travelling toward
 * the AI before a leftward velocity can count as a block, so the posed approach
 * itself never reads as one.
 */
export async function driveAiScenario(
  h: Harness,
  options: UntilOptions = {},
): Promise<{ result: AiOutcome; snapshot: CaromSnapshot }> {
  const start = h.snapshot().score.p1;
  let sawIncoming = false;
  let result: AiOutcome = "timeout";

  const swept = await h.until(
    (s) => {
      const ball = ball0(s);
      if (ball.vx > 0) sawIncoming = true;
      if (s.score.p1 > start) {
        result = "scored";
        return true;
      }
      if (sawIncoming && ball.vx < 0 && ball.x < FIELD_W) {
        result = "blocked";
        return true;
      }
      return false;
    },
    { maxFrames: options.maxFrames ?? 480, poll: options.poll ?? 2 },
  );
  return { result, snapshot: swept.snapshot };
}

/**
 * A live Solo match with the AI paddle far from a ball moving toward it, so the
 * real opponent chases at its own speed for as long as a check watches.
 */
export async function arrangeAiChase(
  h: Harness,
  options: { paddleCy?: number; ballY?: number } = {},
): Promise<void> {
  await startPlaying(h, "solo");
  h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: options.paddleCy ?? 120, vy: 0 });
  h.debug.setBall(0, {
    x: FIELD_CX,
    y: options.ballY ?? 650,
    vx: 200,
    vy: 0,
    spin: 0,
  });
  h.debug.setAiControl(true);
}

/** How fast the AI paddle travels while it is chasing, in px/s. */
export async function driveAiChaseSpeed(
  h: Harness,
  options: { ticks?: number } = {},
): Promise<{ speed: number; delta: number }> {
  const ticks = options.ticks ?? 12;
  const before = h.snapshot().paddles.right.cy;
  await h.advance(ticks);
  const after = h.snapshot().paddles.right.cy;
  return {
    speed: speedOverTicks(after - before, ticks),
    delta: after - before,
  };
}

/**
 * A live Solo match with a ball aimed to arrive at the AI's front face while the
 * AI is still sweeping down through the lane, so it strikes while moving.
 */
export async function arrangeAiMovingHit(h: Harness): Promise<void> {
  await startPlaying(h, "solo");
  h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: 180, vy: 0 }); // above the lane
  h.debug.setBall(0, { x: 1072, y: FIELD_CY, vx: 500, vy: 0, spin: 0 });
  h.debug.setAiControl(true);
}

/* ---- Obstacle bank shots -------------------------------------------------- */

/**
 * Line the ball up 180 px short of `faceX`, level with the obstacle at `y`,
 * travelling straight at that face. `from` is the side it approaches from.
 */
export function arrangeObstacleBounce(
  h: Harness,
  shot: { faceX: number; y: number; from: Side; speed?: number },
): void {
  const speed = shot.speed ?? 600;
  clearPaddles(h);
  h.debug.setBall(0, {
    x: shot.from === "left" ? shot.faceX - 180 : shot.faceX + 180,
    y: shot.y,
    vx: shot.from === "left" ? speed : -speed,
    vy: 0,
    spin: 0,
  });
}

/** Run the real collision until the ball reflects off the struck face. */
export function driveObstacleBounce(
  h: Harness,
  from: Side,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const reversed =
    from === "left"
      ? (s: CaromSnapshot): boolean => ball0(s).vx < 0
      : (s: CaromSnapshot): boolean => ball0(s).vx > 0;
  return h.until(reversed, {
    maxFrames: options.maxFrames ?? 240,
    poll: options.poll ?? 1,
  });
}

/* ---- A ball in open flight ------------------------------------------------ */

/**
 * A live match with the ball posed in mid-flight, clear of the obstacles so a
 * short flight is a straight line. Spin is zeroed so the path is predictable.
 */
export async function arrangeLiveBall(
  h: Harness,
  ball: { x: number; y: number; vx: number; vy?: number },
  mode: Mode = "versus",
): Promise<void> {
  await startPlaying(h, mode);
  clearPaddles(h);
  h.debug.setBall(0, { spin: 0, vy: 0, ...ball });
}

/* ========================================================================== */
/* Rendering, input, audio, pause and UI                                      */
/* ========================================================================== */
//
// The second half of the suite — the checks that read what was DRAWN, what was
// PLAYED, and what the keyboard did — needs three things the scenario helpers
// above do not provide: a cue record stamped with the frame each cue fired on,
// a colour sampler over the rendered canvas, and a way to ask what a single
// frame's render actually asked the context for. The palette is the build's
// own (specs/overview.md), so nothing here knows a colour: the samplers compare
// what was painted against what else was painted. They are gathered here rather
// than folded in above so the two halves of this file stay separable.

import { OBSTACLE_CENTERS, P1_X0, P2_X1, TRAIL_TIME } from "./constants";

/* ---- Controls tolerances -------------------------------------------------- */

/**
 * A clearly non-trivial paddle displacement, in logical units.
 *
 * The controls checks are about which paddle a key moves and which way, not how
 * fast: the speed is the `paddle-movement` category's point, and stating it in
 * both places would fail one build twice for one fault. At PADDLE_SPEED the
 * 36-frame hold `holdMove` defaults to travels 216 units, so this bound is
 * crossed several times over by a build moving the right paddle the right way
 * and never by one that did not move it.
 */
export const MOVE_MIN = 40;

/* ---- Cues ----------------------------------------------------------------- */

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
 * collision — which is what tells a build that plays a cue on the right event
 * apart from one that plays it on every frame, or a frame late.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/* ---- Colour --------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The on-field points the visibility checks sample, in logical units, valid on
 * the scene `arrangeColorScene` poses.
 *
 * Each sits well inside the shape it names — a paddle is 16 wide and an obstacle
 * 20, so a point on the centre line is 8 px from the nearest edge and the 4 px
 * cluster below stays inside the solid body. That margin is the point: a curved
 * or rounded edge is anti-aliased and blends toward whatever is behind it, so a
 * sample on the rim would read as a mixture rather than as the fill.
 */
export const COLOR_POINTS = {
  leftPaddle: { x: (P1_X0 + P1_X1) / 2, y: FIELD_CY },
  rightPaddle: { x: (P2_X0 + P2_X1) / 2, y: FIELD_CY },
  obstacle: OBSTACLE_CENTERS[0],
  /** A clean mid-field spot, clear of the paddles, both obstacles, and the net. */
  ball: { x: 300, y: FIELD_CY },
} as const;

/**
 * Candidate patches of empty field, in logical units, clear of every element
 * this specification places: the paddles, both obstacles at every gyre pose,
 * the net, the parked ball, and the top of the field where the scores sit.
 *
 * The field is dark and every body on it is bright (specs/overview.md), but the
 * mode label's copy and placement are the build's, so no single patch is
 * guaranteed bare. The darkest of several is: a label is drawn to be read, so
 * it is lighter than the field it sits on, and a patch it covers reads lighter
 * than one it does not.
 */
export const FIELD_POINTS: readonly { x: number; y: number }[] = [
  { x: 500, y: 650 },
  { x: 200, y: 600 },
  { x: 1000, y: 300 },
  { x: 1100, y: 620 },
];

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 px out, all of which stay inside the
 * solid body of every shape sampled, so one stray anti-aliased or glow pixel
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

/** A colour's luminance, the reading the field is darkest on. */
function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The bare field's colour: the darkest of the {@link FIELD_POINTS} patches,
 * sampled off the canvas as it stands.
 */
export function sampleField(h: Harness): Rgb {
  const samples = FIELD_POINTS.map((point) => sampleColor(h, point.x, point.y));
  return samples.reduce((darkest, sample) =>
    luminance(sample) < luminance(darkest) ? sample : darkest,
  );
}

/**
 * The build's exported `BACKGROUND`, rasterized: the color the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the
 * same canvas implementation the harness samples with, so a pixel the game
 * never drew over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent color reads
 * as the engine leaves it: the engine composites its clear over the previous
 * frame every frame, which converges on the color's own channels, and a single
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

/** Every point in `COLOR_POINTS` and the bare field, sampled as they stand. */
export function sampleScene(
  h: Harness,
): Record<keyof typeof COLOR_POINTS | "background", Rgb> {
  return {
    leftPaddle: sampleColor(
      h,
      COLOR_POINTS.leftPaddle.x,
      COLOR_POINTS.leftPaddle.y,
    ),
    rightPaddle: sampleColor(
      h,
      COLOR_POINTS.rightPaddle.x,
      COLOR_POINTS.rightPaddle.y,
    ),
    obstacle: sampleColor(h, COLOR_POINTS.obstacle.x, COLOR_POINTS.obstacle.y),
    ball: sampleColor(h, COLOR_POINTS.ball.x, COLOR_POINTS.ball.y),
    background: sampleField(h),
  };
}

/**
 * Pose a clean, static colour scene and paint it: a live match with both paddles
 * centred and the ball parked at the mid-field sample point, so each sample
 * point renders an unobstructed, solid body.
 *
 * The settle is longer than the trail's own life on purpose. Posing the ball
 * teleports it, and the samples it left along the way would otherwise still be
 * drawn as a streak across the field; a still ball for `TRAIL_TIME` retires
 * every one of them, so what is sampled is the ball rather than its wake.
 */
export async function arrangeColorScene(h: Harness): Promise<void> {
  await startPlaying(h, "versus");
  h.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: FIELD_CY, vy: 0 });
  h.debug.setBall(0, {
    x: COLOR_POINTS.ball.x,
    y: COLOR_POINTS.ball.y,
    vx: 0,
    vy: 0,
    spin: 0,
  });
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}

/* ---- Reading one frame's render ------------------------------------------- */

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

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * trail asked for strictly more of these than the same frame with the ball at
 * rest, whatever shape the build chose to draw it as.
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
 * component draws, so the coordinates a drawing call carries are the game's own
 * — and with the camera at its defaults those are logical units. A trail is a
 * sequence of draws rather than one shape, so where a render put its geometry
 * is the direct reading of it: the coordinates behind the ball are the trail,
 * and the ones at the ball are the ball. The leading pair of arguments is the
 * position for every method listed, except the curve calls, whose control
 * points come first and whose endpoint is the last pair.
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

/* ---- Where a frame put its text ------------------------------------------- */

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

/* ---- The AI with nothing to defend ---------------------------------------- */

/**
 * A live Solo match with the ball travelling AWAY from the AI paddle, posed far
 * from anything it could strike, and the AI paddle posed well off its home
 * height, so what the real opponent does from here is governed by the homing
 * rule alone (specs/modes/single-player.md).
 */
export async function arrangeAiHome(
  h: Harness,
  options: { paddleCy: number },
): Promise<void> {
  await startPlaying(h, "solo");
  h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  h.debug.setPaddle("right", { cy: options.paddleCy, vy: 0 });
  h.debug.setBall(0, { x: 1100, y: 200, vx: -300, vy: 0, spin: 0 });
  h.debug.setAiControl(true);
}

/* ---- A shot at one obstacle face ------------------------------------------ */

/** Which face of an axis-aligned obstacle a shot is aimed at. */
export type Face = "left" | "right" | "top" | "bottom";

/**
 * Pose a straight shot at the midpoint of `face` of the axis-aligned obstacle
 * `rect`, starting `runUp` units short of it and travelling at `speed`, with
 * both paddles parked out of the way.
 */
export function arrangeFaceShot(
  h: Harness,
  rect: { x0: number; y0: number; x1: number; y1: number },
  face: Face,
  options: { runUp?: number; speed?: number } = {},
): { vx: number; vy: number } {
  const runUp = options.runUp ?? 180;
  const speed = options.speed ?? 600;
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const shot =
    face === "left"
      ? { x: rect.x0 - runUp, y: cy, vx: speed, vy: 0 }
      : face === "right"
        ? { x: rect.x1 + runUp, y: cy, vx: -speed, vy: 0 }
        : face === "top"
          ? { x: cx, y: rect.y0 - runUp, vx: 0, vy: speed }
          : { x: cx, y: rect.y1 + runUp, vx: 0, vy: -speed };
  clearPaddles(h);
  h.debug.setBall(0, { ...shot, spin: 0 });
  return { vx: shot.vx, vy: shot.vy };
}

/** Run the real collision until the component normal to `face` reverses. */
export function driveFaceShot(
  h: Harness,
  face: Face,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const reversed: Record<Face, (s: CaromSnapshot) => boolean> = {
    left: (s) => ball0(s).vx < 0,
    right: (s) => ball0(s).vx > 0,
    top: (s) => ball0(s).vy < 0,
    bottom: (s) => ball0(s).vy > 0,
  };
  return h.until(reversed[face], {
    maxFrames: options.maxFrames ?? 240,
    poll: options.poll ?? 1,
  });
}

/* ---- The trail, read off the canvas ------------------------------------- */

/** An empty lane: below both obstacles, clear of the paddles and the net. */
export const TRAIL_LANE_Y = 650;

/** Where a trail drive poses the ball, and an empty patch of the same lane. */
export const TRAIL_START_X = 300;
export const TRAIL_BARE_X = 1100;

/** Frames of flight before the frame that is read: longer than the trail's life. */
export const TRAIL_FILL_TICKS = 24;

/** How far a pixel must sit from the bare field to count as lit. */
const LIT_MIN = 10;

/**
 * The widest run of bare field a streak may contain and still be one streak.
 *
 * A trail drawn from samples may be drawn sample by sample, and at the speed
 * cap consecutive samples on the suite's clock are `SPEED_CAP / TICK_HZ`, about
 * eight units, apart; a gap a little wider than that is still the same trail.
 */
const GAP_MAX = 12;

/** How far behind the ball the lane is read, in logical units. */
const TRAIL_SCAN = 240;

/** The lane's bare pixels, by logical x, read with nothing drawn on it. */
export type BareLane = Map<number, Rgb>;

/** Where the lane scan starts behind the ball's center, and where it ends. */
const TRAIL_SCAN_FROM = BALL_R + 3;
const LANE_X0 = 20;

/**
 * Pose the ball in the empty lane at `speed`, fly it long enough to fill the
 * trail, then record exactly one frame. The ball is returned as it was when that
 * frame was drawn, along with the lane as it looked with nothing on it.
 *
 * The bare lane is read first, pixel by pixel, with the ball parked out of the
 * scan at `TRAIL_BARE_X` for longer than the trail's life. Whatever the build
 * draws on the field that is NOT the trail — a mode label whose copy and place
 * are its own, a texture, a vignette — is in that reading too, so a lit pixel
 * is one the flight changed, and nothing static can read as trail.
 */
export async function driveTrail(
  h: Harness,
  speed: number,
): Promise<{ x: number; y: number; bare: BareLane }> {
  await arrangeLiveBall(h, {
    x: TRAIL_BARE_X,
    y: TRAIL_LANE_Y,
    vx: 0,
    vy: 0,
  });
  await h.advance(TRAIL_FILL_TICKS);
  const bare: BareLane = new Map();
  for (let x = LANE_X0; x < TRAIL_BARE_X - 2 * BALL_R; x += 1) {
    const [r, g, b] = h.pixel(x, TRAIL_LANE_Y);
    bare.set(x, { r, g, b });
  }
  h.debug.setBall(0, {
    x: TRAIL_START_X,
    y: TRAIL_LANE_Y,
    vx: speed,
    vy: 0,
    spin: 0,
  });
  await h.advance(TRAIL_FILL_TICKS);
  h.calls.length = 0;
  await h.advance(1);
  const ball = ball0(h.snapshot());
  return { x: ball.x, y: ball.y, bare };
}

/**
 * How far behind the ball the unbroken run of lit pixels reaches along its lane,
 * in logical units, measured from the ball's center.
 *
 * Each pixel is read against the same pixel of the bare lane, so whatever the
 * build's palette and whatever else it draws there, a lit pixel is one the
 * flight changed.
 */
export function trailReach(
  h: Harness,
  ball: { x: number; y: number; bare: BareLane },
): number {
  const ballX = Math.round(ball.x);
  let reach = 0;
  let gap = 0;
  for (let d = TRAIL_SCAN_FROM; d <= TRAIL_SCAN; d += 1) {
    const x = ballX - d;
    const bare = ball.bare.get(x);
    if (bare === undefined) break;
    const [r, g, b] = h.pixel(x, TRAIL_LANE_Y);
    if (colorDistance({ r, g, b }, bare) > LIT_MIN) {
      reach = d;
      gap = 0;
    } else {
      gap += 1;
      if (gap > GAP_MAX) break;
    }
  }
  return reach;
}
