// Refract — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
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
// without a frame passing, and `reset` gives everything back. Posing through it is how a
// scenario is reproducible, and it is the seam the case's specification
// documents. `surface.ts` is that specification as types, and it is the only
// description of the surface this harness reads: the build's own module for it
// is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`, and
// the runtime holds the second element and returns it from `engine.debug`.
// Reading it back off the runtime is the only way a surface reaches a check,
// so a build that returned no surface, or a surface missing an operation,
// fails the checks that reach the game through it. See `readDebugSurface`.
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
  type Game,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
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

/** The case's surface, bound to the state type the build declared. */
export type RefractSurface = RefractDebugApi<RefractState>;

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
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs
 * it through `engine.apply`, so the state it returns is the state the next
 * frame receives. A reading `(state) => R` becomes `() => R`: the driver hands
 * it `engine.state`. Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>) => infer R
    ? () => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its
 * state argument, over the runtime that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type RefractDriver = Driver<RefractState, RefractSurface>;

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

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be
 * mapped to logical units whatever `translate`/`scale` the build applied, the
 * measured width under the current font, and the alignment that places the run
 * about its anchor.
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

/** One cue the build played, as the runtime announced it. */
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
  readonly engine: Engine<RefractState, RefractSurface>;
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose
   * it through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<RefractState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * runtime: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   */
  readonly debug: RefractDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the runtime drew into, holding the last frame that ran.
   * Exposed for {@link captureStill}, which encodes it.
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

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The runtime discards an edge nothing consumed by the end of the frame it
   * was armed in, so a tap that ran no frame would never reach the game.
   */
  tap(code: string): Promise<void>;

  /**
   * Dispatch a REAL pointer event at a logical stage point, through the
   * engine's own pointer input — the player's path, where the sample is read
   * by the next frame's update — as opposed to the debug surface's pointer
   * operations, which are immediate poses. The point is mapped through the
   * current viewport and DPR, so it names the same logical spot under any
   * surface options. Advance a frame after dispatching for the game to read
   * it.
   */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device?: PointerDevice,
  ): void;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the runtime's listeners and release the canvas. */
  dispose(): void;
}

/** A `KeyboardEvent`-shaped event: the runtime reads `code` and `repeat`. */
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
 * A `PointerEvent`-shaped event: the runtime's pointer input reads `clientX`,
 * `clientY`, and `isPrimary`, structurally, so a plain `Event` carrying them
 * drives it exactly as a browser's does.
 */
class PointerLikeEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerId = 1;
  readonly pointerType: PointerDevice;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: string,
    clientX: number,
    clientY: number,
    device: PointerDevice,
  ) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
    this.pointerType = device;
    // The primary button, held on a press and a move and gone on a release,
    // which is what a mouse reports and what a touch or a pen in contact does.
    this.button = type === "pointermove" ? -1 : 0;
    this.buttons = type === "pointerup" ? 0 : 1;
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
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect. The engine reads its context off the canvas element the harness
 * hands it, so EVERYTHING drawn through the engine lands here — the game's own
 * render and the engine's diagnostics overlay alike, which is what lets the
 * overlay check read the overlay's text off `calls`.
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
 * The debug surface the BUILD returned beside its state, read off the runtime
 * that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the runtime keeps the second element, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand
 * in for it, because the build's own module for the surface is never imported.
 *
 * A pair whose second element is no surface — a build that returned
 * `[state, null]`, or something other than an object — is a fault in the
 * build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the
 *   real verdict under the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the
 *   missing surface and fails, by assertion, at the moment a check first
 *   reaches for an operation on it — naming the return the build owes.
 */
function readDebugSurface(
  engine: Engine<RefractState, RefractSurface>,
): RefractSurface {
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
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named.
 *
 * Keys that belong to the RUNTIME rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would
 * replace the verdict below with noise from the machinery reporting it.
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
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

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

/**
 * The imperative reading of the raw surface, over the runtime that holds the
 * state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so
 * a missing surface or a missing operation fails the check that needed it and
 * never the `beforeEach` that built the harness. A member that is not a
 * function (`version`, or an operation the build left out) comes back as it
 * is, which is what lets a check test for an operation by `typeof`.
 *
 * A reading is called with `engine.state` and its result handed back. A pose
 * is run through `engine.apply`, so the runtime stores what it returned and
 * the next frame's `update` receives it; a pose that returns nothing is
 * refused by the runtime with a message naming the rule.
 */
function driveSurface(
  engine: Engine<RefractState, RefractSurface>,
  raw: RefractSurface,
): RefractDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as RefractDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<RefractState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        // The one point a snapshot is read on this engine, so the one place a
        // beam's cells are narrowed. `h.snapshot()` and both `debug.snapshot()`
        // reads inside `until` come through here.
        if (property === "snapshot") {
          return (): unknown =>
            projectCells(op.call(raw, engine.state) as RefractSnapshot);
        }
        return (): unknown => op.call(raw, engine.state);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as RefractState);
      };
    },
  });
}

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's
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

  const engine = createEngine<RefractState, RefractSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
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
  engine.events.on("cue:played", (played) => {
    cues.push(played);
  });

  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
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

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },

    pointer: (type, x, y, device = "mouse") => {
      // The inverse of the engine's own mapping: it reads a client position,
      // subtracts the surface origin (none here), multiplies by DPR, and maps
      // through the viewport to logical units — so a logical point goes back
      // out the same way.
      const view = engine.viewport();
      keys.dispatchEvent(
        new PointerLikeEvent(
          type,
          (view.offsetX + x * view.scale) / dpr,
          (view.offsetY + y * view.scale) / dpr,
          device,
        ),
      );
    },

    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
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
// A review item may declare a `replay` OUTPUT beside its verdict: the frames
// the build itself drew while a check drove it, kept as evidence a reviewer
// can scrub. `captureReplay` is how a check produces one, and `captureStill`
// is its companion for a point whose evidence is one picture. Both are
// evidence, never a verdict: the scenario's own value comes straight back, a
// scenario that throws still leaves what it recorded, a capture that closed no
// frames writes no file, and outside a run — the media directory unset — the
// whole thing is a no-op that still runs the scenario.

/**
 * The environment variable the runner names the media directory in.
 *
 * Unset is not an error: it is the normal state of a suite nobody is
 * collecting media from.
 */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives
 * in: the case's own `validation/<engine>/`, and the `validation/` the runner
 * stages that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/tracing/extend.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest
 * and the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, so an over-long section is
 * THINNED rather than cut short: the reviewer sees the whole section at a
 * lower frame rate instead of its opening at the full one.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its
 * own path would be free to write its evidence under some other point's
 * address.
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
 * Dropping a frame drops the last reference to whatever only that frame drew
 * with: the four tables in front of a recording are shared by every frame in
 * it, so carrying them over whole would put entries in the file that no
 * surviving frame asks for. Every entry here is reached from a kept frame, and
 * every reference inside one is rewritten as it is reached, transitively.
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
    // A recipe's own arguments were encoded when the value was used, so they
    // can only name entries interned before it: rewriting one terminates and
    // cannot re-enter this resource.
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
      // named `__proto__`, and assigning that name reaches the prototype
      // setter instead of writing a field the document carries.
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
      // outline current.
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
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole
 * of what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is
 * kept, each kept frame's `deltaMs` is restated as the time since the frame
 * kept before it, and the last frame is always kept — it is the frame the
 * check's sweep stopped at, and the one a reviewer looks at first. What
 * survives is then re-expressed against tables of its own.
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
      // before it, so the kept deltas still sum to the elapsed time.
      const displaced = kept[kept.length - 1];
      kept.length -= 1;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }

  return retable(recording, kept);
}

/**
 * Write a recording out, reporting rather than raising anything that goes
 * wrong.
 *
 * A capture that closed no frames writes nothing: a declared output that never
 * turned up is already reported as absent, and that is the truthful reading of
 * a section that drew no frames. What lands on disk is gzip rather than raw
 * JSON, which is what keeps a run's whole set of recordings to a few
 * megabytes. Never throws: a file that cannot be written says something about
 * the machine the validators ran on, not about the build.
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
 * await captureReplay(h, "extend", () => driveExtend(h));
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails
 * for the reasons it failed before, and the recording is what a reviewer looks
 * at afterwards to see what the build actually drew while it did.
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
    // In a `finally`, so a scenario that failed still leaves its evidence.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion. What is written is whatever the
 * last frame that RAN left behind, so call it after the frame that poses the
 * thing under test — an `advance(1)` following the arrangement — and before
 * the assertions, so a check that fails still leaves the picture that shows
 * why. Nothing here can change a verdict.
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

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster: the
 * centre pixel plus four neighbours 4 px out. A node's drawn form fills
 * NODE_R (30) of its centre, so the whole cluster stays inside it, and one
 * stray anti-aliased pixel cannot swing the reading.
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
 * The build's exported `BACKGROUND`, rasterized: the color the engine clears
 * the whole canvas to each frame, read back through the same canvas
 * implementation the harness samples with. The fill is repeated so a
 * translucent color reads as the engine's frame-over-frame compositing leaves
 * it.
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
 * Candidate patches of bare bench, in logical units, clear of the largest
 * board's extent (x 352..928, y 152..632 centre to centre, specs/board.md)
 * with NODE_R to spare, and away from the top heading band and the bottom
 * footer where a build's readouts most plausibly sit.
 */
export const BACKGROUND_POINTS: readonly { x: number; y: number }[] = [
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
 */
export function sampleBackground(h: Harness): Rgb {
  const samples = BACKGROUND_POINTS.map((point) =>
    sampleColor(h, point.x, point.y),
  );
  let best = samples[0] as Rgb;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const candidate of samples) {
    const total = samples.reduce(
      (sum, other) => sum + colorDistance(candidate, other),
      0,
    );
    if (total < bestTotal) {
      best = candidate;
      bestTotal = total;
    }
  }
  return best;
}

/** The centre of cell (col, row) on a cols x rows board (specs/board.md). */
export function nodeCenter(
  col: number,
  row: number,
  cols: number,
  rows: number,
): { x: number; y: number } {
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
 * A build may anchor its text through any `translate`/`scale` it likes and
 * align it any way it likes, so the anchor is mapped through the transform the
 * context held at the call and the run is extended about it by its measured
 * width and `textAlign`. This game draws no right-to-left text, so `start`
 * and `end` read as left and right.
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
 * The runtime publishes `cue:played` synchronously from inside `audio.play`,
 * so the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. Cues fire from `update`
 * on the frame their event happens (specs/ui.md), and the pointer poses are
 * applied between frames — so the pattern is: pose, watch, advance one frame,
 * and the cue for the posed event is on that frame.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
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
export function targetCenter(target: TargetSnapshot): {
  x: number;
  y: number;
} {
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
export function pointOutsideEveryTarget(targets: readonly TargetSnapshot[]): {
  x: number;
  y: number;
} {
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
  press: { x: number; y: number },
  release: { x: number; y: number } = press,
  device: PointerDevice = "mouse",
): Promise<void> {
  h.debug.pointerDown(press.x, press.y, device);
  if (release.x !== press.x || release.y !== press.y) {
    h.debug.pointerMove(release.x, release.y, device);
  }
  h.debug.pointerUp(device);
  await h.advance(1);
}
