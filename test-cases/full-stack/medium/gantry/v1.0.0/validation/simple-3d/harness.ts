// Gantry — the case's half of the validator harness, for a build on the
// SIMPLE 3D engine. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over two canvases it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing serves a site,
// nothing polls, and no wall-clock time passes: a check asks for a number of
// ticks and gets exactly that number, at exactly the deltas its clock supplied.
//
// ONE API, THREE ENGINES. This file exports the same `Harness` interface as
// `validation/none/harness.ts` and `validation/structured-3d/harness.ts`, with
// every operation `async`, so a `<category>/<id>.test.ts` file is byte-identical
// in all three directories. The asynchrony is REAL under `none` — each call
// crosses into Chromium — and vacuous here, which costs this harness nothing and
// buys one suite instead of three.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`
// (`specs/instrumentation.md`), the engine holds the second element and returns
// it from `engine.debug`, and reading it back off the engine is the only way a
// surface reaches a check. So a build that returned no surface, or a surface
// missing an operation, fails the checks that reach the game through it. See
// {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `await h.debug.setTool("cable")` and
// `await h.snapshot()`, because `h.debug` is a {@link GantryDriver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state.
//
// FOUR THINGS THE ENGINE OWNS THAT `none` PUTS ON THE SURFACE.
// `specs/instrumentation.md` puts the clock, the projection and the raw input on
// the surface UNDER THE ENGINELESS ENGINE ONLY, because nothing outside an
// engineless build owns its loop, its camera or its keyboard. Here the engine
// owns all four and the surface carries no operation for any of them, so the
// harness supplies them from the engine and puts them where a validator expects:
//
//   - `h.advance(n)` is `engine.advance(n)` off a `ConstantClock(TICK_MS)`, so
//     one frame covers exactly one simulation tick at watch speed 1;
//   - `h.keyDown`/`h.pointerDown`/… dispatch REAL events at the engine's surface,
//     which the game reads through the actions it registered and the pointer the
//     engine maps into logical stage units;
//   - `h.project` goes through the engine's `View`;
//   - `h.cues()` reads the cues the engine announced.
//
// A validator never learns that any of them was engine-only somewhere else.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// one operation sets one field, and `specs/instrumentation.md` says so in as many
// words ("a caller that wants several things arranged makes several calls"). So
// opening a site, emptying the yard, standing a crane up, appending a tape and
// starting a run each live HERE, once, so five hundred suites say what their
// scenario is about in one line and say it the same way. A check that needs only
// part of a sequence calls the operations it needs.
//
// THREE THINGS THE HOST DOES NOT HAVE, AND WHAT STANDS IN FOR EACH. This project
// runs in Node, and the engine is written for a browser. What is missing is
// filled in at the bottom of this file, each with the reason it is safe:
// {@link installHostShims} gives three's renderer the `self` it disposes through,
// {@link stageCanvas} gives the engine the `webgl2` context it takes the moment it
// is created, {@link installAssetFetch} serves the produced files off the
// workspace the way a page serves them, and {@link installAudioContext} decodes a
// produced `.wav` so a build that binds its cues to files still initializes. None
// of them changes what the game computes; each one supplies a browser facility the
// build is entitled to assume.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  applyViewport,
  ConstantClock,
  createEngine,
  fitViewport as fitStageViewport,
  type Clock,
  type DeepReadonly,
  type Engine,
  type Game,
  type RenderApi,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-3d";
import * as THREE from "three";
import { expect } from "vitest";

import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import {
  ASSET_ROOT,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  UNBOUND_KEY,
} from "./constants";
import type {
  AxisName,
  CheckResult,
  GantryDebugApi,
  GantryDriver,
  GantrySnapshot,
  GantryState,
  LoadClass,
  LoadPose,
  MaterialName,
  Projected,
  Screen,
  TapeAction,
  Vec3,
} from "./surface";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The version the surface reports (`GANTRY_DEBUG_VERSION`). */
export const GANTRY_DEBUG_VERSION = 1;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, in the order that file introduces them.
 *
 * SHORTER THAN THE ENGINELESS PROJECT'S LIST BY EIGHT, and the eight are the ones
 * that file puts on the surface for `none` alone: `setAutoStep` and `advance`
 * (the clock), `project` (the projection), and the five input operations. "The
 * clock, the keyboard, the pointer, the camera's projection, and the overlay
 * belong to the Simple 3D engine… and the surface carries no operation for any of
 * them." A build that installed them anyway is not failed for it — nothing here
 * looks — but a build missing one of the operations below cannot be driven at
 * all, so every check that reaches for the surface fails with that fault beside
 * what the specification requires.
 */
export const REQUIRED_OPS = [
  "snapshot",
  "check",
  "reset",
  "setScreen",
  "setMenuIndex",
  "openSite",
  "setCleared",
  "setBest",
  "clearBest",
  "setCamera",
  "startRun",
  "abortRun",
  "clearStructure",
  "addMember",
  "removeMember",
  "setRing",
  "clearRing",
  "addCounterweight",
  "removeCounterweight",
  "setTool",
  "setPendingNode",
  "clearPendingNode",
  "clearProgram",
  "addMoveStep",
  "addCommand",
  "addActionStep",
  "removeStep",
  "clearLoads",
  "addLoad",
  "setLoadTarget",
  "clearObstacles",
  "addObstacle",
  "setAxis",
  "setAxisRate",
  "setBob",
  "setBobVelocity",
  "setLoadPose",
  "setLoadPhase",
  "setSpeedIndex",
] as const;

/**
 * The readings, which take the state and answer with what they read rather than
 * with the next state.
 *
 * The driver has to tell the two apart to know whether an operation goes through
 * `engine.apply` or is handed `engine.state`, and the specification is what
 * separates them: "Readings" is a section of `specs/instrumentation.md` and it
 * holds exactly these two under this engine, `project` having gone to the engine.
 */
export const READINGS: readonly string[] = ["snapshot", "check"];

/**
 * What `cues()` reports a sound it could not name as.
 *
 * NEVER PRODUCED HERE, and it is exported all the same. Under `none` the cue
 * names come from this project's own probe over the produced `.wav` files, which
 * can meet a sound whose file it cannot name; under this engine a cue IS its name
 * — the engine announces `cue:played` carrying the name the game declared — so
 * there is nothing to fail to name. It is exported so a check written against one
 * engine's harness compiles against all three.
 */
export const UNNAMED_CUE = "?";

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure every check that reaches for a missing surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
export const SURFACE_REQUIREMENT =
  "the debug and automation surface src/game.ts's initialize returns beside " +
  "its state, as [state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** Fail the running check on `fault`, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// Gantry's simulation rate is fixed by the specification rather than chosen by
// the suite: `specs/program.md` advances a run in whole `1 / TICK_HZ`-second
// ticks and `specs/state.md` reports the run clock as `tick / TICK_HZ`. So the
// clock a harness supplies is the one that makes ONE FRAME COVER EXACTLY ONE
// TICK at watch speed `1`, and the arithmetic below converts between the ticks a
// check drives and the seconds of run clock they cover — the same arithmetic the
// run clock itself does.

export { TICK_HZ };

/** Seconds of simulated time in one frame. */
export const TICK_DT = 1 / TICK_HZ;

/**
 * Milliseconds of simulated time in one frame: the delta the harness's clock
 * supplies.
 *
 * `(1000 / TICK_HZ) / 1000` is exactly `1 / TICK_HZ` in IEEE 754 at `TICK_HZ`
 * `60`, so a build accumulating the delta it is handed and consuming whole
 * `1 / TICK_HZ` ticks from it takes exactly one tick per frame, indefinitely,
 * with no drift to accumulate. That equality is what makes `advance(n)` mean
 * `n` ticks rather than approximately `n`.
 */
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of run clock in `count` ticks. */
export function seconds(count: number): number {
  return count / TICK_HZ;
}

/** Whole ticks covering `duration` seconds, rounded up. */
export function ticks(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/** Whole ticks covering `duration` seconds, rounded up. Alias of {@link ticks}. */
export function ticksFor(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/**
 * How the stage maps onto a surface of this shape: one uniform scale and a
 * letterbox.
 *
 * THE SAME SHAPE THE OTHER TWO PROJECTS ANSWER WITH, which is the engine's
 * `Viewport` plus the CSS trio. `scale`/`offsetX`/`offsetY` are DEVICE pixels,
 * which is what a pixel reading is addressed in; `cssScale`/`cssOffsetX`/
 * `cssOffsetY` are CSS pixels, which is what a window position is delivered in.
 * On a device pixel ratio of `1` — the shape almost every check runs at — the two
 * agree, which is exactly why carrying only one of them is a trap.
 */
export interface StageViewport extends Viewport {
  /** CSS pixels per logical unit, which is what a window position is in. */
  cssScale: number;
  cssOffsetX: number;
  cssOffsetY: number;
}

/**
 * How Gantry's stage maps onto a surface of this shape.
 *
 * The stage is the case's — the fixed `STAGE_W` by `STAGE_H` logical field
 * `specs/overview.md` gives — so a check states only the window it is asking
 * about. The device half of the fit is the ENGINE's, because the fit under test
 * is the one the engine performs; the CSS half is that same fit read back in the
 * units a window position is delivered in, which is the device fit over the
 * density.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
): StageViewport {
  const view = fitStageViewport(STAGE_W, STAGE_H, cssWidth, cssHeight, dpr);
  return {
    ...view,
    cssScale: view.scale / dpr,
    cssOffsetX: view.offsetX / dpr,
    cssOffsetY: view.offsetY / dpr,
  };
}

/* -------------------------------------------------------------------------- */
/* The project's own directory                                                */
/* -------------------------------------------------------------------------- */

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/simple-3d/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace the build was produced in: `src/`, the produced `assets/`, and
 * this project's own `validation/` all sit directly under it.
 */
const WORKSPACE_ROOT = dirname(PROJECT_ROOT);

/* -------------------------------------------------------------------------- */
/* The game under test                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<GantryState, GantryDebugApi>` here and the engine is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 *
 * The state travels through as the opaque `GantryState` of `surface.ts` for the
 * same reason: `specs/state.md` fixes its shape and the build declares it, but
 * nothing here reads a field of one, so importing the build's declaration would
 * buy nothing and cost the harness its independence from it.
 */
const game = build as unknown as Game<GantryState, GantryDebugApi>;

/**
 * The stage background the build exports beside its game.
 *
 * Handed to the engine exactly as the seeded `src/main.ts` hands it, so the
 * engine a check drives is built the way the played one is. Guarded rather than
 * trusted: a build free to write any CSS color there is also free to write
 * something that is not one, and the engine's own refusal is a better verdict
 * than a harness that would not compile.
 */
const background: string | undefined =
  typeof BACKGROUND === "string" ? BACKGROUND : undefined;

/* -------------------------------------------------------------------------- */
/* What a check reads off one build                                           */
/* -------------------------------------------------------------------------- */

/** One cue the build played, as the engine announced it. */
export interface TimedCue {
  /** The cue's name, one of the eleven `CUES` fixes (`specs/ui.md`). */
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/**
 * One operation a frame made on the screen layer, in the shape
 * `../case-harness/draw-calls` writes one under `none`.
 *
 * The two projects read a build's drawing the same way — "what was called, what
 * was set" — so a check that asks what the build wrote on its readouts reads the
 * same list here as it does there, and `toDrawCall`, `drawnText` and `textDraws`
 * work over it unchanged. Where the two differ is how the list is COLLECTED:
 * under `none` a recorder is injected into the page before the build's first
 * line, and here the engine states the seam outright — "a suite that wants the
 * drawing operations rather than the pixels overrides `getContext` on the canvas
 * it supplies as `screen`, and whatever that returns is the object the game's
 * `render` is handed" (`rendering.ts`).
 */
export type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/**
 * The screen layer's 2D context, recording every call and every property set
 * before it passes it on.
 *
 * IT DELEGATES RATHER THAN STANDS IN: every operation reaches the real context,
 * so the pixels {@link captureStill} keeps are the pixels the build drew and a
 * reading like `measureText` answers what it really answers. What the recorder
 * adds is the list beside them.
 *
 * The list holds ONE FRAME — the most recent one that drew — because that is
 * what a check asks for ("every run of text the frame the build last drew put on
 * its readouts") and because a run of a thousand ticks would otherwise
 * accumulate a million operations. The frame is told by the engine's own
 * counter, which advances at step 2, before the game draws anything.
 */
function recordingContext(
  ctx: CanvasRenderingContext2D,
  frameOf: () => number,
  log: { frame: number; ops: RecordedOp[] },
): CanvasRenderingContext2D {
  const bound = new Map<string, unknown>();
  const record = (op: RecordedOp): void => {
    const frame = frameOf();
    if (frame !== log.frame) {
      log.frame = frame;
      log.ops = [];
    }
    log.ops.push(op);
  };
  const target = ctx as unknown as Record<string, unknown>;
  return new Proxy(ctx, {
    get: (_t, property): unknown => {
      if (typeof property !== "string") return target[property as never];
      const value = target[property];
      if (typeof value !== "function") return value;
      const already = bound.get(property);
      if (already !== undefined) return already;
      const wrapper = (...args: unknown[]): unknown => {
        record({ op: "call", method: property, args });
        return (value as (...a: unknown[]) => unknown).apply(ctx, args);
      };
      bound.set(property, wrapper);
      return wrapper;
    },
    set: (_t, property, value): boolean => {
      if (typeof property === "string") {
        record({ op: "set", property, value });
      }
      target[property as string] = value;
      return true;
    },
  }) as CanvasRenderingContext2D;
}

/** One produced file answered with other bytes, for a check about that file. */
export interface AssetSubstitution {
  /** The bytes the workspace holds, which is how the file is recognized. */
  from: Uint8Array;
  /** The bytes answered in their place. */
  to: Uint8Array;
}

/** How a harness's engine is built, where a check wants something other than the default. */
export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
  clock?: Clock;
  /**
   * Produced files to answer with other bytes while this harness's build runs.
   *
   * THE FILE IS MATCHED BY ITS BYTES, NEVER BY ITS PATH. What a bundler names the
   * copy it emits into `dist/` is the build's business — `specs/assets.md` asks
   * only that each asset be referenced page-relative through the bundler — so a
   * response is recognized by comparing it against the bytes of the committed
   * file rather than against any path. It is what lets a check ask whether what
   * is on screen came out of a particular produced file: serve other bytes under
   * it and see whether the picture follows.
   */
  substituteAssets?: readonly AssetSubstitution[];
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/**
 * Everything a check reads off one build.
 *
 * THE SAME INTERFACE THE OTHER TWO PROJECTS EXPORT. Every member is `async`,
 * every member that reaches the game reaches it through the surface
 * `specs/instrumentation.md` fixes, and nothing here is spelled a way that only
 * makes sense in this process — that is what lets one suite file grade three
 * runtimes.
 *
 * The members below the fold are this engine's alone, and only the handful of
 * engine-specific suites `test-case.toml` points here touch them.
 */
export interface Harness {
  /** Destroy the engine this harness held and drop its listeners. */
  dispose(): Promise<void>;

  /** Every operation `specs/instrumentation.md` names, driven over the engine. */
  readonly debug: GantryDriver;

  /** A fresh read of the game's own state. */
  snapshot(): Promise<GantrySnapshot>;
  /** The static check of `specs/structure.md`, computed on the spot. */
  check(): Promise<CheckResult>;

  /**
   * Run whole simulation ticks, and LEAVE THE WATCH SPEED ALONE.
   *
   * One frame of this harness's clock is `TICK_MS` of simulated time, which is
   * exactly one tick of the pipeline `specs/program.md` fixes at watch speed `1`.
   * A run starts at speed index `0` (`specs/state.md`), which is `RUN_SPEEDS[0]`
   * (`1`), and nothing in this harness ever poses `setSpeedIndex`, so a call here
   * is the tick count it asks for. A check that is ABOUT the watch speed poses it
   * itself and counts what it counts.
   */
  advance(ticks?: number): Promise<void>;

  /** Press a key down, as a player holding it does. */
  keyDown(code: string): Promise<void>;
  /** Release a key. */
  keyUp(code: string): Promise<void>;
  /** Down, one tick, up: the press a build reading actions per frame can see. */
  press(code: string): Promise<void>;
  /** Move the pointer to a logical stage position. */
  pointerMove(x: number, y: number): Promise<void>;
  /** A press at a logical stage position; it moves the pointer there first. */
  pointerDown(x: number, y: number): Promise<void>;
  /** A release at the position the pointer is at. */
  pointerUp(): Promise<void>;
  /** Down, a tick, up, a tick: the click a player's press makes. */
  click(x: number, y: number): Promise<void>;

  /**
   * Where a world position is drawn, in logical stage units, THROUGH THE CAMERA
   * AS IT STANDS — not through the one a previous frame drew.
   *
   * `specs/instrumentation.md` asks `project` for "the point on the stage the
   * world position is drawn at, through the camera as it stands", and it is a
   * reading a check takes right after posing a scenario: a pose that opens a site
   * or sets the camera moves the camera in the same breath, and a click made at a
   * point projected through the previous camera would pick a different node from
   * the one the check named.
   *
   * The engine's own `View`, though, "answers from the camera as it stood at the
   * most recent render" (`camera.md`), and the camera is posed by the game's own
   * `render`, so before a frame has drawn the current state that reading is the
   * engine's construction defaults. {@link poseCameraNow} therefore asks the
   * build's `render` where its camera stands for the state the game is in now —
   * changing no state, because `render` is handed the state read-only and returns
   * nothing — and the point is taken through that camera by the arithmetic
   * `camera.md` states for exactly this case ("a label that must track a moving
   * camera on the same frame projects through three itself, after the camera is
   * posed"). What a check reads is then the same reading it reads under `none`,
   * where the build computes it from the state it is holding.
   */
  project(x: number, y: number, z: number): Promise<Projected>;

  /**
   * The cue names announced since the last read, in order, then cleared.
   *
   * A CUE A POSE RAISES SOUNDS ON THE FRAME THAT FOLLOWS IT, not at the call.
   * `specs/instrumentation.md` says a pose "establishes a precondition and never
   * an outcome; what happens next comes from advancing the real simulation", and
   * under an engine that holds the state by value a pose is pure and cannot
   * reach the audio bus at all — it queues the cue and the next update plays it.
   * So a check that reads a cue advances one frame first, which is correct on
   * every engine and is what keeps one validator file running in all three.
   */
  cues(): Promise<string[]>;
  /** The cue names of the sounds that are looping right now. */
  loopingCues(): Promise<string[]>;

  /** Keep the picture on screen as the review item's `id` output. */
  capture(id: string, name: string): Promise<void>;

  /**
   * Hand the page back its own paint loop, for the rest of this harness's life.
   *
   * A NO-OP HERE, and deliberately still present. Under this engine the game runs
   * in this process over a canvas the harness owns, so there is no page painting
   * on its own and nothing to hand back. The engineless harness DOES hold the
   * build's free-running frames (see `validation/none/paint-gate.js`), and the one
   * check whose subject is that loop asks for them back — so the operation exists
   * on all three harnesses and that check stays one file in three directories.
   */
  releasePaint(): Promise<void>;

  /**
   * Run one of the frames the page is being held back from.
   *
   * A NO-OP HERE, for the reason `releasePaint` gives: this engine draws when the
   * harness's own clock says so and there is no held frame to run.
   */
  paintFrame(): Promise<void>;

  /* ---- This engine's own, for the few suites that are about it ------------ */

  /** The engine this harness built, for a check that reads the scene or the view. */
  readonly engine: Engine<GantryState, GantryDebugApi>;
  /** The engine's current state, read fresh on every access; nothing can write it. */
  readonly state: DeepReadonly<GantryState>;
  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /** What the build stood the game up in, before this harness reset it. */
  readonly openingSnapshot: GantrySnapshot | null;
  /** Every cue the build has played, oldest first, never drained. */
  readonly playedCues: readonly TimedCue[];
  /** Every asset the build asked for and did not get, oldest first. */
  readonly assetFailures: readonly AssetFailure[];
  /**
   * Every path this build fetched, in order, and whether the workspace carried
   * it.
   *
   * The paths are exactly as the build asked for them — relative to the page, as
   * `specs/assets.md` requires — so a check reads both which files a build
   * consumes and how it addresses them.
   */
  assetRequests(): { path: string; found: boolean }[];
  /** How many responses this harness answered with substituted bytes. */
  substitutedAssets(): number;
  /**
   * Draw the game as it stands into the engine's scene, advancing nothing.
   *
   * The scene is populated by the build's own `render`, which runs on a frame, so
   * a check that poses a scenario and then reads the scene without advancing
   * would be reading the yard some earlier frame drew. This runs `render` over
   * the state as it stands — handed over read-only, returning nothing, so no
   * state moves, no cue sounds, no input is consumed and no clock turns — and
   * leaves the scene and the camera holding the yard the current state
   * describes. It is what {@link Harness.project} does before it projects.
   *
   * A check that has just advanced a frame needs none of this: the frame drew.
   */
  draw(): Promise<void>;

  /**
   * Move the pointer to a WINDOW position, in CSS pixels off the surface's own
   * origin, rather than to a logical stage point.
   *
   * The one door past the fit, for the one check that is ABOUT the fit: every
   * other check states a stage point and lets {@link Harness.pointerMove} put it
   * where the stage was fitted. Under `none` the same event is delivered through
   * Playwright's own mouse, which is what a window position means there.
   */
  windowPointerMove(cssX: number, cssY: number): Promise<void>;

  /** The canvas the engine drew the screen layer on, which {@link capture} encodes. */
  readonly screen: Canvas;
  /**
   * Every operation the frame the build last drew made on the screen layer, in
   * order — what `window.__tcabRec.last()` answers under `none`.
   *
   * Call it after the frame that draws the thing under test. A frame that has
   * only been posed has drawn nothing, so a check advances one frame and then
   * reads, exactly as it does there.
   */
  screenOps(): Promise<RecordedOp[]>;
  /** The ticks this harness has driven, 1-based, as `engine.frame().count` reports. */
  tick(): number;
  /**
   * Reflect the raw surface without invoking it: `typeof` for each name, and the
   * `version` it reports.
   */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };
}

/* -------------------------------------------------------------------------- */
/* Reaching the surface                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so an operation a check reaches for by
 * name reports the build's missing surface rather than looking like a harness bug.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): GantryDebugApi {
  return new Proxy({} as GantryDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine that
 * holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`, the engine keeps
 * the second element, and `engine.debug` is the only way it reaches a check.
 *
 * A build that returned no pair at all never gets this far, because the engine
 * rejects `initialize` itself and the rejection reaches the check that built the
 * harness with the engine's own message. What IS decided here is a pair whose
 * second element is no surface. That is a fault in the build and not in this
 * harness, so it must not present as one: it is neither thrown from here — which
 * would bury the verdict under the harness's own stack — nor swallowed.
 * {@link missingSurface} stands in and fails, by assertion, at the moment a check
 * first reaches for an operation on it.
 */
function readDebugSurface(surface: unknown): {
  raw: GantryDebugApi;
  fault: string | null;
} {
  if (typeof surface !== "object" || surface === null) {
    const fault = `engine.debug holds ${surface === null ? "null" : typeof surface}, not an object`;
    return { raw: missingSurface(fault), fault };
  }
  const held = surface as Record<string, unknown>;
  const missing = REQUIRED_OPS.filter(
    (name) => typeof held[name] !== "function",
  );
  if (missing.length > 0) {
    const fault = `engine.debug is missing ${String(missing.length)} of the operations specs/instrumentation.md names: ${missing.join(", ")}`;
    return { raw: surface as GantryDebugApi, fault };
  }
  return { raw: surface as GantryDebugApi, fault: null };
}

/**
 * The imperative, asynchronous reading of the raw surface, over the engine that
 * holds the state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing surface or a missing operation fails the check that needed it and never
 * the `beforeEach` that built the harness.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is
 * run through `engine.apply`, so the engine stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * engine with a message naming the rule. Every member answers a promise, because
 * the same operation under `none` crosses into a browser and does.
 */
function driveSurface(
  engine: Engine<GantryState, GantryDebugApi>,
  raw: GantryDebugApi,
): GantryDriver {
  return new Proxy({} as GantryDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") {
        // An operation the specification requires and the build did not install
        // fails the check that reached for it, with the verdict
        // `specs/instrumentation.md` asks for. Left as it was found, the call
        // would land as "h.debug.setTool is not a function", which reads as a
        // fault in this harness rather than in the build. Anything else the
        // surface carries — `version`, or a plain property a build added — is
        // passed through untouched.
        const required: readonly string[] = REQUIRED_OPS;
        if (!required.includes(property)) return member;
        // `async`, so the failure arrives as a rejection like every other
        // operation's: the contract says each one answers a promise, and a check
        // that wrote `await h.debug.setTool(…)` should not have to know that one
        // of them threw before it could.
        return async (): Promise<never> =>
          failSurface(
            `engine.debug.${property} is ${member === undefined ? "absent" : typeof member}, not a function`,
          );
      }
      const op = member as (
        state: DeepReadonly<GantryState>,
        ...args: unknown[]
      ) => unknown;
      // Both spellings are `async` rather than `Promise.resolve(…)`, so that a
      // throw is a REJECTION and never a synchronous throw. An operation can
      // raise for reasons the specification states — "An argument outside the
      // domain its operation states is invalid, and the call fails loudly" — and
      // the engine raises for one of its own, a pose that answered `undefined`.
      // A check asserting either with `.rejects` is asserting the same thing it
      // would assert under `none`, where the call crosses into a browser and a
      // fault always comes back as a rejection.
      if (READINGS.includes(property)) {
        return async (): Promise<unknown> => op.call(raw, engine.state);
      }
      return async (...args: unknown[]): Promise<void> => {
        engine.apply((state) => op.call(raw, state, ...args) as GantryState);
      };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Opening a harness                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Build an engine over canvases of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * THE OPTIONS ARE THE ONES THE SEEDED `src/main.ts` PASSES — the design size, the
 * build's exported `BACKGROUND`, the touch layout, the asset root, and shadow maps
 * — so one harness serves every build of this case and the engine a check drives
 * is the engine the played game runs on. Everything else the build decided lives
 * inside `src/game.ts`.
 *
 * THE OPENING SEQUENCE, and why each part of it is here. The engine is built, the
 * events are subscribed BEFORE `initialize` so the game's own loading and its
 * opening cues are observable, `initialize` runs, the surface is read off
 * `engine.debug`, one snapshot is taken of what the build stood the game up in,
 * and then `reset` is posed. From that point the game stands where
 * `specs/instrumentation.md` says a `reset` leaves it — the title screen, site `0`
 * open, nothing cleared, an idle run, `simTime` `0` — and it changes only when a
 * check says so, because the clock is this harness's and nothing ticks between
 * calls.
 *
 * THE OPENING SNAPSHOT IS TAKEN RATHER THAN INFERRED. `specs/ui.md` says of the
 * title screen "The game opens on `title`", which is a fact about what a FRESH
 * game opens on rather than about what a `reset` puts back, and every check runs
 * after the reset, so that half of the requirement would be invisible without a
 * reading taken first.
 *
 * AUDIO IS ARMED WITH A REAL KEY EVENT, for the reason `specs/assets.md` gives:
 * "Sound does not start before the player's first interaction with the page", and
 * the engine "opens the audio context on the first pointer or key event it sees".
 * `UNBOUND_KEY` is bound to no action on any screen (`specs/controls.md`), so
 * arming changes nothing a check could read — and it is done here rather than left
 * to a check, so no check has to remember it and none reports silence from a build
 * that was sounding perfectly.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  installHostShims();
  installAssetFetch();
  installAudioContext();

  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  const stage = stageCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const screen = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );

  // THE SEAM `rendering.ts` STATES, taken exactly as it states it: the engine
  // hands the game "the screen layer's 2D context, exactly as the screen canvas
  // returned it", so overriding `getContext` here is what puts the recorder
  // between the build's readouts and the canvas they land on. The frame the
  // engine has reached is read lazily, because the engine does not exist yet.
  const drawLog: { frame: number; ops: RecordedOp[] } = { frame: -1, ops: [] };
  let frameOf = (): number => 0;
  const screenContext = recordingContext(
    screen.getContext("2d") as unknown as CanvasRenderingContext2D,
    () => frameOf(),
    drawLog,
  );
  Object.defineProperty(screen, "getContext", {
    configurable: true,
    value: (kind: string): unknown => (kind === "2d" ? screenContext : null),
  });

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<GantryState, GantryDebugApi>({
    canvas: stage as unknown as HTMLCanvasElement,
    screen: screen as unknown as HTMLCanvasElement,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background,
    layout: LAYOUT,
    assetRoot: ASSET_ROOT,
    // Shadow maps, which `src/main.ts` asks for and only `createEngine` can.
    shadows: true,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  frameOf = (): number => engine.frame().count;

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its opening cues observable: construction runs no game code, so nothing
  // has happened yet.
  const assetFailures: AssetFailure[] = [];
  const playedCues: TimedCue[] = [];
  const pending: string[] = [];
  const looping = new Set<string>();
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    playedCues.push({ cue, t, gain, frame: engine.frame().count });
    pending.push(cue);
  });
  engine.events.on("cue:looped", ({ cue, t, gain }) => {
    playedCues.push({ cue, t, gain, frame: engine.frame().count });
    pending.push(cue);
    looping.add(cue);
  });
  engine.events.on("cue:stopped", ({ cue }) => {
    looping.delete(cue);
  });

  // Where this harness's own traffic starts in the process-wide log. Taken
  // before `initialize`, which is where a build loads what it draws with.
  const assetsFrom = assetLog.length;

  // In force from here until this harness is disposed, so a build that loads its
  // models on `initialize` gets the substituted bytes.
  const swaps: ActiveSubstitution[] = (options.substituteAssets ?? []).map(
    (one) => ({ from: one.from, to: one.to, count: 0 }),
  );
  activeSubstitutions.push(...swaps);

  await engine.initialize();

  const { raw, fault } = readDebugSurface(engine.debug);
  const debug = driveSurface(engine, raw);

  const openingSnapshot =
    fault === null
      ? (raw.snapshot(engine.state) as GantrySnapshot | null)
      : null;

  // A GENUINE key event, so the engine's audio unlocks exactly as it does for a
  // player. No frame runs around it: `UNBOUND_KEY` is bound to no action, so
  // there is no edge for a frame to deliver and nothing for one to consume.
  dispatchKey(events, "keydown", UNBOUND_KEY);
  dispatchKey(events, "keyup", UNBOUND_KEY);

  if (fault === null) await debug.reset();

  // WHY A DRIVE HANDS THE EVENT LOOP A TURN. `engine.advance(n)` returns a
  // promise, but the `n` frames have already run by the time it does: the engine
  // steps them synchronously and resolves after the last one. So a check that
  // drives a reference tape to its end holds this worker's event loop for as long
  // as that simulation takes, and awaiting an already-settled promise does not
  // give the loop back — it queues a microtask, which runs before the loop is
  // reached at all. Vitest reports a running file to its runner over a socket
  // served by that same loop, and a report left unanswered for long enough is
  // abandoned, which spoils the RUN over a check that passed. So one real turn of
  // the loop is let through whenever the frames just run have held it for
  // {@link YIELD_AFTER_MS}. Nothing measured here depends on wall-clock time —
  // the clock is this harness's and the engine reads no other — so the turn
  // changes no reading, and it costs a microsecond, only after a drive has
  // already spent a tenth of a second.
  const YIELD_AFTER_MS = 100;
  let yieldedAt = Date.now();
  const step = async (count: number): Promise<void> => {
    await engine.advance(count);
    if (Date.now() - yieldedAt >= YIELD_AFTER_MS) {
      await new Promise<void>((done) => {
        setImmediate(done);
      });
      yieldedAt = Date.now();
    }
  };

  /* ---- The camera as it stands ------------------------------------------ */
  //
  // `h.project` has to answer "through the camera as it stands"
  // (`specs/instrumentation.md`), and the engine's `view()` answers through the
  // camera as it stood at the most recent RENDER (`camera.md`). Between a pose
  // and the frame that draws it the two are different cameras, and every check
  // that projects a node and then clicks it is taken in that gap: `openSite`
  // puts the camera back at its start pose, `setCamera` moves it outright, and
  // neither has drawn anything yet.
  //
  // So the camera is posed the only way anything but the build can pose it: by
  // asking the build. `render` is handed the state READ-ONLY and returns
  // nothing, so calling it changes no state, plays no cue, consumes no input and
  // moves no clock — the whole of what it does that outlives the call is write
  // the scene and the camera the next frame would have written anyway, and draw
  // the readouts, which go to a canvas of this harness's own rather than to the
  // one `capture` keeps.

  const probeCanvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const probeScreen = probeCanvas.getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
  const probeApi: RenderApi = {
    scene: engine.scene,
    camera: engine.camera,
    screen: probeScreen,
    frame: () => engine.frame(),
    viewport: () => engine.viewport(),
    view: () => engine.view(),
  };

  /**
   * Pose the engine's camera for the state the game is in now, by running the
   * build's own `render` over it.
   *
   * The screen layer is cleared and given the viewport transform first, exactly
   * as step 4 of the engine's own frame does, so the build draws its readouts
   * into the same coordinates it always draws them in.
   */
  const poseCameraNow = (): void => {
    probeScreen.setTransform(1, 0, 0, 1, 0, 0);
    probeScreen.clearRect(0, 0, probeCanvas.width, probeCanvas.height);
    applyViewport(probeScreen, engine.viewport());
    game.render(engine.state, probeApi);
  };

  /** Scratch, never handed out: one point and its two matrices per projection. */
  const probePoint = new THREE.Vector3();
  const probeFrustum = new THREE.Frustum();
  const probeViewProjection = new THREE.Matrix4();

  // A LOGICAL STAGE POINT IS DELIVERED AT THE WINDOW POSITION IT IS DRAWN AT.
  // `specs/instrumentation.md` gives the pointer operations in logical stage
  // units, and the engine reads a real event's `clientX`/`clientY` and maps it
  // "through the same fit the game draws under". So the harness performs the
  // inverse: the letterbox bar, then the scale, both in CSS pixels, which is what
  // an event carries. At this harness's default shape — the stage's own size at
  // one device pixel per CSS pixel — that map is the identity.
  let pointerX = 0;
  let pointerY = 0;
  const onWindow = (x: number, y: number): { x: number; y: number } => {
    const view = engine.viewport();
    const cssScale = view.scale / dpr;
    return {
      x: view.offsetX / dpr + x * cssScale,
      y: view.offsetY / dpr + y * cssScale,
    };
  };
  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    const at = onWindow(x, y);
    pointerX = at.x;
    pointerY = at.y;
    dispatchPointer(events, type, at.x, at.y);
  };

  const harness: Harness = {
    async dispose() {
      for (const swap of swaps) {
        const at = activeSubstitutions.indexOf(swap);
        if (at >= 0) activeSubstitutions.splice(at, 1);
      }
      engine.destroy();
    },
    debug,

    snapshot: () => debug.snapshot(),
    check: () => debug.check(),

    advance: (count = 1) => step(count),

    async keyDown(code) {
      dispatchKey(events, "keydown", code);
    },
    async keyUp(code) {
      dispatchKey(events, "keyup", code);
    },

    async press(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press
      // the build can actually see: the engine arms an edge when the event
      // arrives and discards it at the end of the frame that did not consume it,
      // so a tap that ran no frame would never reach the game, and an action read
      // as a LEVEL is only held if a frame runs while the key is down.
      dispatchKey(events, "keydown", code);
      await step(1);
      dispatchKey(events, "keyup", code);
    },

    async pointerMove(x, y) {
      pointer("pointermove", x, y);
    },
    async pointerDown(x, y) {
      pointer("pointerdown", x, y);
    },
    async pointerUp() {
      // At the position the pointer is at, which is where the last move or press
      // left it — `specs/instrumentation.md` takes no coordinates here, and a
      // release somewhere else would be a move the caller never made.
      dispatchPointer(events, "pointerup", pointerX, pointerY);
    },

    async click(x, y) {
      // The same gesture a player makes, delivered through the same path:
      // `specs/instrumentation.md` says "a click is a `pointerDown` followed by a
      // `pointerUp`", and the pointer does not move between them, so the press
      // never reaches `CLICK_SLOP` and stays a click rather than an orbit drag
      // (`specs/controls.md`). A tick runs inside the press so a build that reads
      // the pointer once a frame sees it held, and a tick runs after the release
      // so a build that acts on the frame that reads the release has acted by the
      // time this returns.
      pointer("pointerdown", x, y);
      await step(1);
      pointer("pointerup", x, y);
      await step(1);
    },

    async project(x, y, z) {
      poseCameraNow();
      const camera = engine.camera;
      // Both refreshes fold in what `render` just wrote — a position or a
      // `lookAt` into the world matrix, a `fov` or a set of extents into the
      // projection — which is what makes the reading agree with the picture the
      // renderer would draw. The engine's own `View` does the same two before
      // every reading it takes.
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();

      // `visible` is read from the WORLD point, against the frustum derived from
      // the combined matrix rather than from the divided coordinates: dividing by
      // a negative `w` folds a point behind the camera back inside the `-1..1`
      // box, and a node behind the camera is not drawn. That is the engine's own
      // test, and it is "in front of the camera and inside the stage" — what
      // `specs/instrumentation.md` asks `visible` for.
      probePoint.set(x, y, z);
      probeViewProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      probeFrustum.setFromProjectionMatrix(probeViewProjection);
      const visible = probeFrustum.containsPoint(probePoint);

      // World to clip, then clip to the logical field. NDC runs `-1..1` with
      // `+Y` up and the stage runs `0..STAGE_W` by `0..STAGE_H` with `y` down, so
      // this is the flip as well as the scale — the mapping `camera.md` states.
      probePoint.project(camera);
      return {
        x: ((probePoint.x + 1) / 2) * STAGE_W,
        y: ((1 - probePoint.y) / 2) * STAGE_H,
        visible,
      };
    },

    async cues() {
      return pending.splice(0, pending.length);
    },
    async loopingCues() {
      return [...looping];
    },

    async releasePaint() {
      // Nothing paints on its own here; see the declaration.
    },

    async paintFrame() {
      // Nothing is held back here; see the declaration.
    },

    async capture(id, name) {
      // The still is addressed by the review item's output id; the name is what
      // the reviewer is being shown, and it goes to the run log so a person
      // scanning the output can tell one still from another without opening it.
      await captureStill(harness, id);
      console.log(`gantry: captured ${id} — ${name}`);
    },

    async draw() {
      poseCameraNow();
    },

    async windowPointerMove(cssX, cssY) {
      pointerX = cssX;
      pointerY = cssY;
      dispatchPointer(events, "pointermove", cssX, cssY);
    },

    engine,
    get state() {
      return engine.state;
    },
    surfaceFault: fault,
    openingSnapshot,
    playedCues,
    assetFailures,
    assetRequests: () => assetLog.slice(assetsFrom).map((one) => ({ ...one })),
    substitutedAssets: () =>
      swaps.reduce((total, swap) => total + swap.count, 0),
    screen,
    async screenOps() {
      return [...drawLog.ops];
    },
    tick: () => engine.frame().count,

    probe(names) {
      const target = raw as unknown as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof target[name];
      return { version: target["version"], ops };
    },
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A still is addressed by the STAGED path of the suite that produced it —
 * `validation/rigging/attach.test.ts` — because that is the path the review item's
 * declared script resolves to, and so the only name the case's manifest and the
 * runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 */
function mediaDestination(outputId: string, extension: string): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;

  const within = relative(PROJECT_ROOT, testPath);
  if (within === "" || within.startsWith("..") || isAbsolute(within)) {
    throw new Error(
      `the running suite \`${testPath}\` is not inside the validator project ` +
        `\`${PROJECT_ROOT}\`, so its outputs would be addressed under some ` +
        "other name",
    );
  }

  const suite = within.split(sep).join("/");
  const destination = join(
    mediaDir,
    STAGED_PROJECT_DIR,
    suite,
    `${outputId}.${extension}`,
  );
  const root = resolve(mediaDir);
  const at = resolve(destination);
  if (at !== root && !at.startsWith(root + sep)) {
    throw new Error(
      `the output \`${outputId}\` would be written to \`${at}\`, outside the ` +
        `media directory \`${root}\` the runner collects — refusing rather ` +
        "than writing somewhere nothing will look",
    );
  }
  return destination;
}

/**
 * Keep the picture on screen as the review item's `outputId` output.
 *
 * WHAT IS KEPT IS THE SCREEN LAYER, and that is the whole of what this host can
 * give. The 3D picture is rasterized by a GPU driver behind a `webgl2` context,
 * and this process has none: the context the engine renders through
 * ({@link stageCanvas}) answers three's queries and draws nothing, so there are no
 * scene pixels to encode. The screen layer is real — the engine draws it through a
 * genuine 2D rasterizer — so what a reviewer gets is every readout, menu, title
 * and result the build drew over the yard, at the moment the last frame that ran
 * left them, and nothing of the yard itself.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 *
 * A capture that cannot be written is reported as an output that never turned up,
 * which is a fact about the host rather than about the build, so it warns rather
 * than raising: a check must not fail because the media directory was read-only.
 */
export async function captureStill(
  h: Harness,
  outputId: string,
): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, await h.screen.encode("png"));
  } catch (error) {
    console.warn(`gantry: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* The reference cranes and tapes                                             */
/* -------------------------------------------------------------------------- */

/** A lattice node, as `designs.json` writes one. */
export type LatticeNode = readonly [number, number, number];

/** One member of a design: its two nodes and its material. */
export type DesignMember = readonly [LatticeNode, LatticeNode, MaterialName];

/** One tape step, in the shape `poseTape` appends and a snapshot reports. */
export type TapeStepSpec =
  | {
      readonly kind: "move";
      readonly commands: readonly {
        readonly axis: AxisName;
        readonly target: number;
        readonly rate: number;
      }[];
    }
  | { readonly kind: "action"; readonly action: TapeAction };

/**
 * One crane and the tape that runs it.
 *
 * `members` is ORDERED, and posing it in that order gives each member the id its
 * index here carries — which is what every force readout, every `broken` entry
 * and every `removeMember` in this suite is keyed by (`specs/instrumentation.md`:
 * "`addMember` gives the member the structure's `nextMemberId` and advances it by
 * one", and `clearStructure` returns that counter to `0`).
 */
export interface CraneDesign {
  /** The site this design was authored for, counted from 1 in the file. */
  readonly site: number;
  readonly name: string;
  readonly ring: LatticeNode | null;
  readonly counterweights: readonly LatticeNode[];
  readonly members: readonly DesignMember[];
  readonly tape: readonly TapeStepSpec[];
}

/**
 * The six reference cranes and tapes, one per site, in site order.
 *
 * A COPY beside this harness rather than an import across the tree: a validator
 * project reaches nothing outside itself, and the file it would have reached is
 * inside a reference build, which is not what a run produces. Read at module load
 * with `readFileSync` rather than imported as JSON, because the workspace's
 * `tsconfig.json` does not set `resolveJsonModule` and a validator project must
 * compile under the build's own compiler options.
 */
export const DESIGNS: readonly CraneDesign[] = (
  JSON.parse(readFileSync(join(PROJECT_ROOT, "designs.json"), "utf8")) as {
    sites: CraneDesign[];
  }
).sites;

/**
 * The smallest crane that stands: a ring on a short braced tower, one rail, and
 * the bracing that makes both rigid.
 *
 * WHAT A VALIDATOR USES WHEN ITS REQUIREMENT IS NOT ABOUT THE CRANE — the run
 * screen's readouts, the watch speed, a cue, an axis controller. Twenty-one
 * members instead of the sixty to a hundred and thirty a reference design
 * carries, so a scenario that just needs a crane to exist costs twenty-one edits
 * rather than a hundred.
 *
 * WHY IT IS SHAPED THIS WAY, rule by rule from `specs/structure.md`:
 *
 *   - The tower is the cube between the four ground anchors every site carries
 *     and the ring's bottom flange at `y = 2`, braced with one diagonal on each
 *     of its four sides and one across its top. That is the classic sufficient
 *     bracing of a cube on a fixed base: without it the tower is a mechanism and
 *     the tower solve goes singular.
 *   - The ring sits at `(0, 2, 0)`, whose `y` is not `0` — "the ring sits on a
 *     tower, not on the ground".
 *   - The arm is the mast node `(0, 8, 0)`, tied to all four top-flange nodes so
 *     it is rigid, and the rail tip `(4, 4, 0)`, tied to two flange nodes, to the
 *     mast, and to the rail itself. The tie to the mast is the one member at the
 *     tip with a vertical component: without it every member there lies in the
 *     `y = 4` plane and the tip is free to fall, which is a singular arm solve.
 *   - The single rail runs from a top-flange node outward, horizontal, in the
 *     arm, and its two ends stand at different horizontal distances from the slew
 *     axis — the four track rules, satisfied by one member, with the near end as
 *     the track origin the trolley starts at.
 *
 * Every node lies inside every site's envelope and clear of every site's
 * obstacles, and the crane costs `981.43` against the smallest budget of `3000`,
 * so it poses on all six sites unrefused.
 */
export const MINIMAL_CRANE: CraneDesign = {
  site: 0,
  name: "Minimal",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    // The four legs, anchor to bottom flange.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    // The bottom flange square, and one diagonal across it.
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    // One diagonal on each of the tower's four sides.
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // The track, and the three ties that hold its far end up.
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[2, 4, 2], [4, 4, 0], "strut"],
    [[0, 8, 0], [4, 4, 0], "strut"],
  ],
  tape: [],
};

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. Nothing here fabricates an outcome: a pose "establishes a
// precondition and never an outcome; what happens next comes from advancing the
// real simulation" (`specs/instrumentation.md`).

/**
 * Open a site, leaving the build screen showing.
 *
 * `openSite` carries the effects `specs/state.md` states for opening a site — the
 * site's own loads and obstacles back in the yard, the undo history emptied, the
 * pending node and the shown check cleared, the camera back at its start pose,
 * the run back to its idle placeholder — and then shows `build`. It reaches any
 * site whether or not it has been unlocked, which is what lets a check about site
 * five's envelope run without playing four sites to reach it.
 */
export async function openSite(h: Harness, index: number): Promise<void> {
  await h.debug.openSite(index);
}

/**
 * The isolated world every validator starts from: no loads, no obstacles.
 *
 * The yard a site opens with is the site's authored set, and almost no check is
 * about that set: a check on a lift wants one load and a check on a strike wants
 * one obstacle. So the yard is emptied and exactly what the requirement concerns
 * is added back — never parked "somewhere harmless", because containment leans on
 * the rules that are under test.
 *
 * Loads and obstacles are the site's rather than the structure's, so this refuses
 * nothing and changes nothing that is built.
 */
export async function emptyYard(h: Harness): Promise<void> {
  await onEditScreen(h, async () => {
    await h.debug.clearLoads();
    await h.debug.clearObstacles();
  });
}

/**
 * The empty world: no loads, no obstacles, no structure, no tape.
 *
 * Three screens' worth of poses in one call — the site's and the structure's on
 * the build screen, the tape's on the program screen — so the screen is taken
 * where each applies and put back where the check was standing.
 */
export async function clearAll(h: Harness): Promise<void> {
  await onEditScreen(h, async () => {
    await h.debug.clearLoads();
    await h.debug.clearObstacles();
    await h.debug.clearStructure();
  });
  await onScreen(h, "program", () => h.debug.clearProgram());
}

/**
 * Pose a whole crane as the ordered sequence of edits that BUILDS it — the ring,
 * then each member in order, then the counterweights — so it passes exactly the
 * rules a player builds under.
 *
 * THE ORDER IS THE POINT. `specs/instrumentation.md`: "A caller that wants a whole
 * crane poses it as the sequence of edits that builds it, which is what puts it
 * under the same rules a player builds under." Every refusal in
 * `specs/structure.md` therefore applies unchanged, and the crane that stands at
 * the end is one a player could have built.
 *
 * THE STRUCTURE IS EMPTIED FIRST, so the first member placed takes id `0` and the
 * ids run upward in the order the design lists them — which is what every force
 * readout, `broken` entry and `removeMember` in this suite is keyed by.
 * `clearStructure` is refused by nothing.
 *
 * THE RING GOES FIRST because it can: with nothing built, the only ring refusals
 * left are the envelope and the budget, and placing it first means no later member
 * can be refused for joining the arm to the tower outside it.
 *
 * AND IT THROWS IF ANY EDIT WAS REFUSED. A refusal is silent by design — "no
 * member appears, no cost is spent" — so a scenario whose crane quietly lost a
 * member would grade a different crane from the one it described. One snapshot at
 * the end says whether every edit landed, and names the first that did not.
 */
export async function poseCrane(
  h: Harness,
  design: CraneDesign,
): Promise<void> {
  await onScreen(h, "build", async () => {
    await h.debug.clearStructure();
    if (design.ring !== null) {
      await h.debug.setRing(design.ring[0], design.ring[1], design.ring[2]);
    }
    for (const [a, b, material] of design.members) {
      await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], material);
    }
    for (const node of design.counterweights) {
      await h.debug.addCounterweight(node[0], node[1], node[2]);
    }
  });

  const { structure } = await h.snapshot();
  const placed = new Set(structure.members.map((m) => edgeKey(m.a, m.b)));
  const missing = design.members.findIndex(
    ([a, b]) => !placed.has(edgeKey(nodeOf(a), nodeOf(b))),
  );
  if (missing >= 0) {
    const [a, b, material] = design.members[missing] as DesignMember;
    fail(
      `every edit of the ${design.name} crane to be accepted ` +
        `(specs/structure.md), so member ${missing} — a ${material} from ` +
        `(${a.join(", ")}) to (${b.join(", ")}) — stands`,
      `refused: the structure carries ${structure.members.length} of ` +
        `${design.members.length} members`,
    );
  }
  if (design.ring !== null && structure.ring === null) {
    fail(
      `the ${design.name} crane's slew ring at (${design.ring.join(", ")}) to ` +
        "be accepted (specs/structure.md)",
      "refused: the structure carries no ring",
    );
  }
  if (structure.counterweights.length !== design.counterweights.length) {
    fail(
      `the ${design.name} crane's ${design.counterweights.length} ` +
        "counterweights to be accepted (specs/structure.md)",
      `${structure.counterweights.length} stand`,
    );
  }
}

/** The smallest crane that stands, posed on the open site. */
export async function standMinimalCrane(h: Harness): Promise<void> {
  await poseCrane(h, MINIMAL_CRANE);
}

/**
 * Append a tape, step by step, through the tape operations.
 *
 * A move step is `addMoveStep` for its first command and one `addCommand` per
 * command after it, because `specs/instrumentation.md` gives no operation that
 * appends a whole step: "Appends a move step carrying one command", then "Adds a
 * command to the move step at `index`". The index is the step's own position in
 * the tape, so this counts from whatever the tape already holds — it APPENDS
 * rather than replaces, and a check that wants an empty tape first calls
 * `debug.clearProgram` or {@link clearAll}.
 *
 * Tape edits apply on the program screen alone, so the screen is taken there and
 * put back: what a check reads afterwards is the tape it asked for and the screen
 * it was on.
 *
 * It throws if the tape did not take the steps it was given: the editor's
 * refusals are silent (`specs/program.md` accepts a rate greater than `0` and at
 * most the axis's max, one command per axis per step, and nothing else), so a
 * scenario running a tape it did not get would grade the wrong run.
 */
export async function poseTape(
  h: Harness,
  steps: readonly TapeStepSpec[],
): Promise<void> {
  const before = (await h.snapshot()).program.length;
  await onScreen(h, "program", async () => {
    for (const [offset, step] of steps.entries()) {
      const at = before + offset;
      if (step.kind === "action") {
        await h.debug.addActionStep(step.action);
        continue;
      }
      const [first, ...rest] = step.commands;
      if (first === undefined) {
        fail(
          "every move step to carry at least one command (specs/program.md)",
          `step ${at} carries none`,
        );
      }
      await h.debug.addMoveStep(first.axis, first.target, first.rate);
      for (const command of rest) {
        await h.debug.addCommand(
          at,
          command.axis,
          command.target,
          command.rate,
        );
      }
    }
  });

  const program = (await h.snapshot()).program;
  if (program.length !== before + steps.length) {
    fail(
      `the tape to take all ${steps.length} steps (specs/program.md)`,
      `it holds ${program.length - before} of them`,
    );
  }
  for (const [offset, step] of steps.entries()) {
    const got = program[before + offset];
    if (got === undefined || got.kind !== step.kind) {
      fail(
        `step ${offset} of the posed tape to be a ${step.kind} step`,
        got === undefined ? "nothing" : `a ${got.kind} step`,
      );
    }
    if (step.kind === "move" && got.kind === "move") {
      if (got.commands.length !== step.commands.length) {
        fail(
          `step ${offset} to carry all ${step.commands.length} commands ` +
            "(specs/program.md)",
          `it carries ${got.commands.length}`,
        );
      }
    }
  }
}

/**
 * Start a run, and fail the check if it was refused.
 *
 * `startRun` poses the `run` action: the same refusals, the same `run-start` cue,
 * the same move to the run screen (`specs/program.md`). A refused start leaves
 * the state exactly as it was and is silent, so this reads the phase back — a
 * scenario that thought it was running and was not would read an idle
 * placeholder's zeros as a simulation result.
 *
 * The snapshot it answers with is the run at tick `0`: "nothing has ticked at the
 * call, so `run.tick` reads `0` immediately after it, and the axes, the pivot,
 * and the bob stand at the run-start values" `specs/state.md` gives.
 */
export async function startRun(h: Harness): Promise<GantrySnapshot> {
  await h.debug.startRun();
  const snapshot = await h.snapshot();
  if (snapshot.run.phase !== "running") {
    const { issues } = await h.check();
    fail(
      "the run to start, so the structure has no readiness issue and the tape " +
        "is not empty (specs/program.md)",
      `refused: run.phase is "${snapshot.run.phase}" and check() reports ` +
        `[${issues.join(", ")}]`,
    );
  }
  return snapshot;
}

/** Run `count` ticks, and answer the state they left. */
export async function runTicks(
  h: Harness,
  count: number,
): Promise<GantrySnapshot> {
  await h.advance(count);
  return h.snapshot();
}

/**
 * Run a tick at a time until `predicate` holds, and FAIL the check on the cap.
 *
 * The cap is not a quiet ceiling: a scenario that waited for a load to attach and
 * never saw it attach has learned something about the build, and reporting that
 * as "the predicate did not hold, carry on" would let the check fall through to
 * an assertion about a state it never reached. So the cap fails the item, naming
 * how long it waited.
 *
 * The predicate is sampled BEFORE anything is driven, so a condition that already
 * holds answers at zero ticks. Capture whatever the scenario needs to be true
 * beforehand rather than reading it out of the sweep.
 */
export async function runUntil(
  h: Harness,
  predicate: (snapshot: GantrySnapshot) => boolean,
  maxTicks: number,
  what = "the condition",
): Promise<GantrySnapshot> {
  let snapshot = await h.snapshot();
  if (predicate(snapshot)) return snapshot;

  for (let ran = 0; ran < maxTicks; ran += 1) {
    await h.advance(1);
    snapshot = await h.snapshot();
    if (predicate(snapshot)) return snapshot;
  }

  fail(
    `${what} within ${maxTicks} ticks (${(maxTicks / TICK_HZ).toFixed(2)}s ` +
      "of run clock)",
    `it never held: after ${maxTicks} ticks the run is ` +
      `"${snapshot.run.phase}"` +
      (snapshot.run.cause === null ? "" : ` (${snapshot.run.cause})`),
  );
}

/**
 * The yard holding exactly one load: cleared, then one added and given its pad.
 *
 * `addLoad` starts a load "at rest with its lift point at `(x, y, z)`" and gives
 * it a target pose equal to its starting pose, so the pad is a second call —
 * which is also what lets a check pose a load that is ALREADY where it is wanted.
 */
export async function addOneLoad(
  h: Harness,
  cls: LoadClass,
  mass: number,
  from: LoadPose,
  to: LoadPose,
): Promise<void> {
  await onEditScreen(h, async () => {
    await h.debug.clearLoads();
    await h.debug.addLoad(cls, mass, from.x, from.y, from.z, from.yaw);
    await h.debug.setLoadTarget(0, to.x, to.y, to.z, to.yaw);
  });
}

/** The yard holding exactly one obstacle: the box with that corner and size. */
export async function addOneObstacle(
  h: Harness,
  min: Vec3,
  size: Vec3,
): Promise<void> {
  await onEditScreen(h, async () => {
    await h.debug.clearObstacles();
    await h.debug.addObstacle(min.x, min.y, min.z, size.x, size.y, size.z);
  });
}

/* -------------------------------------------------------------------------- */
/* Small shared readings                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Run `body` on `screen`, and put the screen back where it was.
 *
 * `specs/instrumentation.md`: "Each pose applies on the screens its section names
 * and does nothing on any other, exactly as the control it stands for does." The
 * structure poses are the build screen's and the tape poses are the program
 * screen's, so a helper that edits either has to be standing on the right one —
 * and has to leave the check where it found it, because the screen is a thing
 * checks read. `setScreen` "shows a named screen and sets nothing else", so
 * nothing else moves either way.
 */
async function onScreen<T>(
  h: Harness,
  screen: Screen,
  body: () => Promise<T>,
): Promise<T> {
  const was = (await h.snapshot()).screen;
  if (was === screen) return body();
  await h.debug.setScreen(screen);
  try {
    return await body();
  } finally {
    await h.debug.setScreen(was);
  }
}

/**
 * Run `body` on a screen the SITE poses apply on, and put the screen back.
 *
 * `specs/instrumentation.md`: "The site poses apply on the build and program
 * screens, with no run in progress." Either of the two will do, so a check
 * already standing on the program screen is left there and only one that is
 * somewhere else is moved — to `build`, which is where a site opening leaves a
 * check anyway.
 *
 * THE SECOND HALF OF THAT PRECONDITION IS THE CALLER'S. A run in progress refuses
 * every site pose whatever screen is showing, and nothing here aborts a run to get
 * around it: a helper that ended a check's run to empty its yard would be posing
 * an outcome. A check that wants a different yard poses it before it starts the
 * run, which is also the only order in which it means anything — "the loads a run
 * carries are the ones standing when it starts".
 */
async function onEditScreen<T>(h: Harness, body: () => Promise<T>): Promise<T> {
  const was = (await h.snapshot()).screen;
  if (was === "build" || was === "program") return body();
  await h.debug.setScreen("build");
  try {
    return await body();
  } finally {
    await h.debug.setScreen(was);
  }
}

/** A design's lattice triple as the vector the snapshot reports. */
function nodeOf(node: LatticeNode): Vec3 {
  return { x: node[0], y: node[1], z: node[2] };
}

/** A member's two nodes, in an order that is the same either way round. */
function edgeKey(a: Vec3, b: Vec3): string {
  const one = `${a.x},${a.y},${a.z}`;
  const two = `${b.x},${b.y},${b.z}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

/** The straight-line distance between two world positions. */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Where a lattice node is drawn, as a point a click can pick it by.
 *
 * `specs/controls.md` fixes how a click PICKS rather than how the yard is drawn,
 * so a check that wants to click a node asks the build where it drew it — "a
 * press and release at a visible node's projected point picks that node". Run a
 * frame after posing the yard and before calling this, for the reason
 * {@link Harness.project} gives.
 */
export async function nodePoint(h: Harness, node: Vec3): Promise<Projected> {
  return h.project(node.x, node.y, node.z);
}

/* -------------------------------------------------------------------------- */
/* Input, as a player delivers it                                             */
/* -------------------------------------------------------------------------- */
//
// The engine "attaches its `keydown` and `keyup` listeners to the event target the
// `surface` option supplies" and its pointer listeners to the same target, and
// "dispatching a `KeyboardEvent`-shaped event at that target drives an action
// exactly as a player's key does" (`input.md`). So these are the whole of the
// input path: a plain `Event` carrying the fields the engine reads, dispatched at
// the target this harness owns. Nothing is bypassed — the bindings, the edges, the
// pointer map, the click and orbit rules and the screen restrictions all run
// exactly as they do for a player.

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
 * A `PointerEvent`-shaped event.
 *
 * The engine reads `clientX`, `clientY`, `pointerId`, `pointerType`, `isPrimary`,
 * `button` and `buttons`, and maps the position through the same fit the game
 * draws under: the client position less the surface's origin, times the device
 * pixel ratio, through the inverse viewport. At this harness's default shape —
 * the stage's own size at one device pixel per CSS pixel, over a surface that
 * reports no origin — that map is the identity, so a logical stage point is
 * dispatched directly.
 *
 * `buttons` is deliberately absent. `pointer.md`: it "is `null` when the event
 * carried no mask, which a hand-dispatched event commonly does… a press adds its
 * button, a move changes nothing, and a release drops the button it names." That
 * is exactly the bookkeeping a caller wants, and stating a mask by hand is how a
 * dispatched drag ends up holding a button it already released.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerId = 0;
  readonly pointerType = "mouse";
  readonly button = 0;

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

function dispatchKey(
  events: EventTarget,
  type: "keydown" | "keyup",
  code: string,
): void {
  events.dispatchEvent(new KeyEvent(type, code));
}

function dispatchPointer(
  events: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  events.dispatchEvent(new PointerEvt(type, x, y));
}

/* -------------------------------------------------------------------------- */
/* What this host does not have                                               */
/* -------------------------------------------------------------------------- */
//
// Everything below fills in a browser facility the engine is written against and
// Node does not carry. Each one is installed once, at the first `createHarness`,
// and none of them is ever uninstalled: they are additive — an absolute URL still
// reaches the real `fetch`, and a host that already has the global keeps it — so
// nothing outside this project can tell they are there.
//
// NONE OF THEM CHANGES WHAT THE GAME COMPUTES. The simulation is render-free by
// specification ("Game state advances from ticks and input alone, independent of
// the canvas, of the renderer, and of wall-clock time"), so a context that draws
// nothing costs a check nothing but the pixels. What the shims buy is that the
// build's own `initialize` — which loads eight produced models and eleven produced
// sounds — completes here exactly as it does in a page.

/**
 * The globals three's renderer expects a browser to carry.
 *
 * `THREE.WebGLRenderer` keeps its animation driver on `self` and calls
 * `cancelAnimationFrame` on it from `dispose`, which `engine.destroy()` calls. In
 * Node there is no `self`, the driver's context stays `null`, and every
 * `h.dispose()` would throw from inside three. Naming `globalThis` as `self` is
 * the whole fix.
 *
 * `requestAnimationFrame` is deliberately NOT supplied. Nothing here drives frames
 * off a host callback — `engine.advance` steps them directly — and a no-op stub
 * would turn a stray `engine.run()` into a silent hang instead of a loud failure.
 */
function installHostShims(): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host["self"] ??= globalThis;
  host["cancelAnimationFrame"] ??= (): void => {};
}

/**
 * A canvas that yields the `webgl2` context the engine takes the moment it is
 * created, and draws nothing.
 *
 * WHY A STUB AND NOT A REAL CONTEXT. The engine renders through a real
 * `THREE.WebGLRenderer`, and a renderer needs a context to construct over. Node
 * has none, and reaching for a headless GPU would buy the one thing these checks
 * are not about — the scene's pixels — at the cost of a native dependency, a
 * driver, and a result that differs by machine. So the context answers three's
 * queries plausibly and discards its draws: the scene graph, the camera, the
 * `View`, the viewport and the frame order are all real, and only the rasterizer
 * is absent. `specs/instrumentation.md` is what makes that sound: "Game state
 * advances from ticks and input alone, independent of the canvas, of the
 * renderer, and of wall-clock time."
 *
 * The element is an `EventTarget` because three attaches its context-lost
 * listeners to the canvas, and it carries no `style`, which the engine's canvas
 * fit explicitly tolerates ("A canvas driven headlessly behind a supplied surface
 * may expose no `style` at all").
 */
function stageCanvas(width: number, height: number): StubCanvas {
  return new StubCanvas(width, height);
}

/** A GL enum constant reads as an all-caps identifier; a method never does. */
const GL_ENUM_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * The limits and strings `getParameter` answers with, keyed by constant NAME.
 *
 * `VERSION` matters more than it looks: three parses `/^WebGL (\d)/` off it and
 * refuses a context whose major version it cannot read. The `MAX_*` figures are
 * plausible rather than borrowed from any particular device — three sizes arrays
 * from several of them, so zero would be wrong in a way that only shows up as an
 * empty draw much later.
 */
const GL_PARAMETERS: Readonly<Record<string, unknown>> = {
  VERSION: "WebGL 2.0 (Gantry validator stub)",
  SHADING_LANGUAGE_VERSION: "WebGL GLSL ES 3.00 (Gantry validator stub)",
  VENDOR: "The Test Cabinet",
  RENDERER: "Gantry validator stub",
  MAX_TEXTURE_SIZE: 4096,
  MAX_CUBE_MAP_TEXTURE_SIZE: 4096,
  MAX_3D_TEXTURE_SIZE: 2048,
  MAX_ARRAY_TEXTURE_LAYERS: 256,
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_VERTEX_ATTRIBS: 16,
  MAX_VERTEX_UNIFORM_VECTORS: 1024,
  MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
  MAX_VARYING_VECTORS: 30,
  MAX_DRAW_BUFFERS: 8,
  MAX_RENDERBUFFER_SIZE: 4096,
  MAX_UNIFORM_BUFFER_BINDINGS: 24,
  MAX_UNIFORM_BLOCK_SIZE: 65536,
  MAX_SAMPLES: 4,
  SAMPLES: 0,
  UNPACK_ALIGNMENT: 4,
};

/** The canvas the engine renders the scene through, and its `webgl2` context. */
class StubCanvas extends EventTarget {
  width: number;
  height: number;
  private context: unknown = null;

  constructor(width: number, height: number) {
    super();
    this.width = width;
    this.height = height;
  }

  getContext(id: string): unknown {
    if (id !== "webgl2") return null;
    this.context ??= glContext(this);
    return this.context;
  }
}

/**
 * A WebGL2 context that answers rather than draws.
 *
 * A `Proxy` over a small target, because the WebGL2 surface is some five hundred
 * members and enumerating them by hand would be a maintenance burden that bought
 * nothing. Anything spelled as an all-caps identifier is a GL enum constant and
 * gets a stable unique number; everything else is a method, memoized so a member's
 * identity is stable across reads. The handful below answer with something three
 * can use; the rest accept anything and return `undefined`, which covers the whole
 * state-setting half of the API.
 */
function glContext(canvas: StubCanvas): unknown {
  const numbers = new Map<string, number>();
  const names = new Map<number, string>();
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  // Above the enum range a real context uses, so a stubbed value is never
  // mistaken for a borrowed one, and never near a float, so identity is exact.
  let nextNumber = 0x10000;

  const constant = (name: string): number => {
    const known = numbers.get(name);
    if (known !== undefined) return known;
    const value = nextNumber++;
    numbers.set(name, value);
    names.set(value, name);
    return value;
  };

  const answers: Record<string, (...args: never[]) => unknown> = {
    getContextAttributes: () => ({
      alpha: true,
      antialias: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }),
    getParameter: ((pname: number): unknown => {
      const name = names.get(pname);
      // Built per read rather than shared: three writes the result into its own
      // state and would otherwise hold a buffer this stub could change under it.
      if (name === "SCISSOR_BOX" || name === "VIEWPORT") {
        return new Int32Array([0, 0, canvas.width, canvas.height]);
      }
      if (name === "MAX_VIEWPORT_DIMS") return new Int32Array([4096, 4096]);
      if (name === undefined) return 0;
      return GL_PARAMETERS[name] ?? 0;
    }) as (...args: never[]) => unknown,
    // Every extension is absent. three treats a null extension as a capability it
    // does not have and falls back, which is the conservative path.
    getExtension: () => null,
    getSupportedExtensions: () => [],
    // The highest precision, so three's shader precision negotiation settles on
    // `highp` and every program it builds is the same one everywhere.
    getShaderPrecisionFormat: () => ({
      rangeMin: 127,
      rangeMax: 127,
      precision: 23,
    }),
    // Every GL object is an empty object with its own identity. Nothing reads
    // through one; what matters is that two creations are never the same object,
    // because three keys its caches by them.
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    createBuffer: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createVertexArray: () => ({}),
    createSampler: () => ({}),
    fenceSync: () => ({}),
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => "",
    getShaderInfoLog: () => "",
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getActiveUniform: ((_program: unknown, index: number) => ({
      name: `uniform${String(index)}`,
      size: 1,
      type: constant("FLOAT"),
    })) as (...args: never[]) => unknown,
    getActiveAttrib: ((_program: unknown, index: number) => ({
      name: `attribute${String(index)}`,
      size: 1,
      type: constant("FLOAT"),
    })) as (...args: never[]) => unknown,
    getError: () => 0,
    isContextLost: () => false,
  };

  const target: Record<string, unknown> = { canvas };
  Object.defineProperty(target, "drawingBufferWidth", {
    get: () => canvas.width,
    enumerable: true,
  });
  Object.defineProperty(target, "drawingBufferHeight", {
    get: () => canvas.height,
    enumerable: true,
  });

  return new Proxy(target, {
    get(held, property): unknown {
      if (typeof property !== "string") return Reflect.get(held, property);
      if (property in held) return Reflect.get(held, property);
      if (GL_ENUM_NAME.test(property)) return constant(property);
      const memoized = methods.get(property);
      if (memoized !== undefined) return memoized;
      const answer = answers[property] as
        | ((...args: unknown[]) => unknown)
        | undefined;
      const method = (...args: unknown[]): unknown => answer?.(...args);
      methods.set(property, method);
      return method;
    },
    // A GL context reports every member as present, and three feature-tests by
    // reading rather than by `in`. Saying so keeps the two consistent.
    has(held, property): boolean {
      return typeof property === "string" ? true : Reflect.has(held, property);
    },
  });
}

/** Where a relative asset URL is looked for, in order, under the workspace. */
const ASSET_SEARCH_PATH: readonly string[] = ["", "public", "dist"];

/** Whether the asset fetcher has already been installed on this process. */
let assetFetchInstalled = false;

/**
 * Every relative URL anything in this process has fetched, oldest first.
 *
 * THE ONE PLACE A BUILD'S ASSET TRAFFIC IS OBSERVABLE HERE. Under `none` the same
 * reading is taken off the page — `page.on("requestfailed")`, `performance
 * .getEntriesByType("resource")` — and under this engine the fetch below is the
 * whole of it: the engine's asset loader resolves a path under `ASSET_ROOT` and
 * fetches it, and nothing else in a conforming build fetches anything at all
 * ("No part of the build decodes glTF itself, and nothing else fetches an
 * asset", `specs/assets.md`).
 *
 * It is process-wide and never drained, because the shim is installed once and a
 * check reads what one harness's build asked for while it was the only one
 * running. A harness records where in the list it started, so what it answers is
 * its own build's traffic.
 */
const assetLog: { path: string; found: boolean }[] = [];

/** One live byte-for-byte substitution, and how often it has answered. */
interface ActiveSubstitution {
  from: Uint8Array;
  to: Uint8Array;
  count: number;
}

/**
 * The substitutions in force right now, one entry per {@link HarnessOptions}
 * `substituteAssets` of every harness that is still open.
 *
 * Module-level because the fetch shim is installed once on the process, and
 * emptied of a harness's own entries when it is disposed, so a check that opens
 * two harnesses gets the substituted bytes in one and the committed bytes in the
 * other.
 */
const activeSubstitutions: ActiveSubstitution[] = [];

/** Whether two byte strings are the same file. */
function sameBytes(one: Uint8Array, two: Uint8Array): boolean {
  if (one.length !== two.length) return false;
  for (let at = 0; at < one.length; at += 1) {
    if (one[at] !== two[at]) return false;
  }
  return true;
}

/**
 * Serve the produced files off the workspace, the way the page serves them.
 *
 * The engine's asset loader resolves a path to a URL relative to the page —
 * `assets/models/ring.glb` — and fetches it. Node's `fetch` refuses a relative
 * URL outright, so without this every produced model and every produced sound
 * would fail to load, and a build whose `initialize` awaits them, exactly as
 * `specs/assets.md` tells it to, would never initialize at all. That is a fact
 * about the host and not about the build, and failing five hundred items over it
 * would be the worst possible verdict.
 *
 * So a relative URL is read off disk, under the workspace, at the first of
 * {@link ASSET_SEARCH_PATH} that carries it: the committed tree first — "every
 * produced file is committed under `ASSET_ROOT`" — then Vite's `public/` and the
 * built `dist/`, which are the two ways `specs/assets.md` leaves a build to
 * arrange for the built site to carry them. A file that is nowhere comes back as
 * a `404`, which is what a page would answer and what makes the engine announce
 * `asset:failed` with the status: a build that did not produce a required file
 * still fails the items about it.
 *
 * ABSOLUTE URLS ARE UNTOUCHED and go to the real `fetch`, so this is additive:
 * nothing else in the process can tell it is here.
 */
function installAssetFetch(): void {
  if (assetFetchInstalled) return;
  assetFetchInstalled = true;

  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : null;
    if (url === null || /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
      return original(input, init);
    }
    for (const under of ASSET_SEARCH_PATH) {
      const at = join(WORKSPACE_ROOT, under, url);
      try {
        const bytes = new Uint8Array(readFileSync(at));
        assetLog.push({ path: url, found: true });
        for (const swap of activeSubstitutions) {
          if (!sameBytes(bytes, swap.from)) continue;
          swap.count += 1;
          return new Response(swap.to.buffer as ArrayBuffer, { status: 200 });
        }
        // `BodyInit` does not admit a `Uint8Array<ArrayBufferLike>` in this
        // TypeScript, though the runtime takes one; the buffer it views is
        // the same bytes and is admitted.
        return new Response(bytes.buffer as ArrayBuffer, { status: 200 });
      } catch {
        // The next root, or the 404 below.
      }
    }
    assetLog.push({ path: url, found: false });
    return new Response(null, {
      status: 404,
      statusText: `no file under the workspace for ${url}`,
    });
  }) as typeof globalThis.fetch;
}

/** Whether the decoding audio context has already been installed. */
let audioContextInstalled = false;

/**
 * An `AudioContext` that decodes a produced `.wav` and sounds nothing.
 *
 * `specs/assets.md` has the build "bind each `.wav` to its cue name through the
 * engine's audio", and the engine's loader decodes through a host `AudioContext`.
 * Node has none, so without this every `api.audio.load` rejects, the cue stays
 * undeclared, and a build that plays it "throws, naming the cue" — from inside
 * `update`, which fails the frame and every check that drove one. Again a fact
 * about the host rather than about the build.
 *
 * So decoding is real: the RIFF header is read for the rate, the channel count
 * and the frame count, which is everything a caller can observe about a decoded
 * buffer. The samples are not converted — nothing in this process can hear them —
 * so `getChannelData` answers silence of the right length. A file that is not a
 * RIFF/WAVE rejects, which is the honest verdict on a cue backed by something
 * that is not a wave file.
 *
 * The graph half is inert. Every node the engine builds accepts a connection and
 * does nothing, and the engine's audio bus already wraps every graph operation in
 * a `try` ("The audio graph throws during synthesis, a loop, or a placement → The
 * event is emitted and the frame continues"), so a cue reaches `cue:played` with
 * its gain either way. What a check reads about sound is the events, which are
 * the engine's own record and not the graph's.
 */
function installAudioContext(): void {
  if (audioContextInstalled) return;
  audioContextInstalled = true;
  const host = globalThis as unknown as Record<string, unknown>;
  host["AudioContext"] ??= StubAudioContext;
}

/** An inert audio node: it accepts a connection and every parameter write. */
function audioNode(): Record<string, unknown> {
  const param = (): Record<string, unknown> => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
    setTargetAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  });
  return new Proxy(
    {
      connect: (): unknown => audioNode(),
      disconnect: (): void => undefined,
      start: (): void => undefined,
      stop: (): void => undefined,
      setPosition: (): void => undefined,
      setOrientation: (): void => undefined,
    } as Record<string, unknown>,
    {
      get: (held, property): unknown => {
        if (typeof property !== "string") return Reflect.get(held, property);
        if (property in held) return Reflect.get(held, property);
        // Anything else a node carries is an AudioParam or a plain setting; a
        // fresh param answers both readings and every write.
        return param();
      },
      set: () => true,
    },
  );
}

/** The decoded shape a caller can observe: the header's figures, and silence. */
interface DecodedAudio {
  sampleRate: number;
  length: number;
  duration: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** The host `AudioContext` stand-in: a real decoder over an inert graph. */
class StubAudioContext {
  readonly sampleRate = 48000;
  readonly currentTime = 0;
  readonly destination = audioNode();
  readonly listener = audioNode();
  state = "running";

  decodeAudioData(data: ArrayBuffer): Promise<DecodedAudio> {
    try {
      return Promise.resolve(decodeWave(data));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  createGain(): unknown {
    return audioNode();
  }
  createOscillator(): unknown {
    return audioNode();
  }
  createBufferSource(): unknown {
    return audioNode();
  }
  createPanner(): unknown {
    return audioNode();
  }
  createStereoPanner(): unknown {
    return audioNode();
  }
  createBuffer(): unknown {
    return audioNode();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The rate, the channel count and the frame count a `.wav` declares.
 *
 * Chunk-walked rather than read at fixed offsets, because a produced file may
 * carry a `LIST` or a `fact` chunk between `fmt ` and `data` and a fixed-offset
 * reader would report nonsense for it.
 */
function decodeWave(data: ArrayBuffer): DecodedAudio {
  const view = new DataView(data);
  const tag = (at: number): string =>
    String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );
  if (data.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  let at = 12;
  while (at + 8 <= data.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= data.byteLength) {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataBytes = Math.min(size, data.byteLength - body);
    }
    // Chunks are word-aligned, so an odd size carries one pad byte.
    at = body + size + (size % 2);
  }
  if (channels === 0 || sampleRate === 0 || bitsPerSample === 0) {
    throw new Error("no fmt chunk");
  }

  const bytesPerFrame = (bitsPerSample / 8) * channels;
  const length =
    bytesPerFrame === 0 ? 0 : Math.floor(dataBytes / bytesPerFrame);
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels,
    getChannelData: () => new Float32Array(length),
  };
}

/* -------------------------------------------------------------------------- */
/* What a suite reads from here                                               */
/* -------------------------------------------------------------------------- */

export type {
  AxisName,
  AxisView,
  CheckResult,
  FailCause,
  GantryDebugApi,
  GantryDriver,
  GantrySnapshot,
  GantryState,
  LoadClass,
  LoadPhase,
  LoadPose,
  MaterialName,
  MemberForce,
  MemberView,
  Obstacle,
  PickView,
  PointerView,
  Projected,
  ReadinessIssue,
  RunLoadView,
  RunPhase,
  RunView,
  Screen,
  SiteLoad,
  SiteView,
  StartIssue,
  StepView,
  StructureView,
  TapeAction,
  Tool,
  Vec3,
} from "./surface";
