// Gantry — the case's half of the validator harness, for the STRUCTURED 3D build.
// CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over two canvases it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing serves a site, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// ONE API, THREE ENGINES. This file exports the same `Harness` interface as
// `validation/none/harness.ts` and `validation/simple-3d/harness.ts`, with every
// operation `async`, so a `<category>/<id>.test.ts` file is byte-identical in all
// three directories. The asynchrony is REAL under `none` — each of its calls
// crosses into Chromium — and vacuous here, which costs this project nothing and
// buys one suite instead of three. Where a member below returns an
// already-resolved promise, that is why.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check
// (`specs/instrumentation.md`: "The engine holds it and returns it from
// `engine.debug`, and it is reached that way alone: nothing is installed on the
// page"). So a build that returned no surface, or a surface missing an operation,
// fails the checks that reach the game through it rather than crashing them. See
// {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. Thinly. Under this engine the framework's state is
// LIVE — the world holds one `GantryState` and an operation acts on it at the
// moment of the call — so a pose is one call and a reading is one call, with no
// state threading in between and nothing to await. The DRIVER below is therefore
// the surface with each operation wrapped in a resolved promise and nothing else:
// `h.debug.setTool("cable")` is `debug.setTool("cable")`, awaited for the sake of
// the file that will also run under `none`. Gantry runs in ONE world for the whole
// session and every screen is a value of the state's `screen` field, so a pose
// that changes the screen takes effect at the call rather than riding a level
// transition, and a check poses and reads with no frame between them.
//
// THE CLOCK IS THE ENGINE'S, AND SO IS THE INPUT, AND SO IS THE PROJECTION.
// `specs/instrumentation.md` puts no clock, no input and no projection operation
// on the surface under an engine, because all three belong to the runtime: "The
// clock, the keyboard, the pointer, the camera's projection, and the overlay
// belong to the Structured 3D engine ... and the surface carries no operation for
// any of them." So `h.advance(n)` is `engine.advance(n)` off a clock this harness
// supplies, `h.keyDown` and the pointer verbs are real events dispatched at the
// engine's own surface, and `h.project` goes through `world.camera.worldToLogical`.
// A validator reaches all of them by the same names it uses under `none`, where
// the surface carries them, and never learns which side of the seam they came
// from.
//
// THE CLOCK IS ONE TICK PER FRAME, AND THAT IS THE WHOLE OF WHY IT IS CONSTANT.
// `specs/program.md` fixes Gantry's simulation at `TICK_HZ`, and the mode
// consumes whole `1 / TICK_HZ`-second ticks out of the time a frame delivered. A
// `ConstantClock(1000 / TICK_HZ)` therefore makes one frame exactly one tick at
// watch speed `1` — which is the speed a run starts at — so `advance(n)` runs the
// `n` ticks a check asked for and nothing else. A check that is ABOUT the watch
// speed poses `setSpeedIndex` itself and counts what it counts; nothing in this
// file ever poses it.
//
// ONE ENGINE PER HARNESS, AND ONE HARNESS PER CHECK. `createHarness` builds fresh
// canvases, a fresh event target and a fresh engine every time, so every check
// drives a game that has just initialized, with no key held, nothing muted and
// nothing built. `dispose` destroys the engine and drops its listeners.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// one operation sets one field, and `specs/instrumentation.md` says so in as many
// words ("a caller that wants several things arranged makes several calls"). So
// opening a site, emptying the yard, standing a crane up, appending a tape and
// starting a run each live HERE, once, so five hundred suites say what their
// scenario is about in one line and say it the same way. A check that needs only
// part of a sequence calls the operations it needs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type World,
} from "@test-cabinet/structured-3d";
import type { Canvas } from "@napi-rs/canvas";
import { expect } from "vitest";

// The BUILD's own module, and the only one of its modules this project imports.
// It is imported for its VALUE — the `GameDefinition` the engine is created over,
// which cannot come from anywhere else — and never for its types: what a check
// holds the build to is `./surface`, the case's own statement of the contract, so
// the definition is cast to it below. A build that declared its surface
// differently must fail the items that reach for the missing operation, not fail
// to compile this harness.
import { game as build } from "../src/game";

import { fail } from "./assert";
import {
  ASSET_ROOT,
  CUES,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
} from "./constants";
import {
  createEngineSurface,
  defineAudioContext,
  serveWorkspaceAssets,
  type EngineSurface,
} from "./host";
import type {
  AxisName,
  CheckResult,
  GantryDebugApi,
  GantryDriver,
  GantrySnapshot,
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
 * What `cues()` reports a sound it could not name as.
 *
 * IT CANNOT HAPPEN HERE, and it is exported anyway. Under `none` a cue's name is
 * recovered from the produced `.wav` the build played, and a sound whose file
 * could not be identified is reported under this placeholder rather than guessed
 * at; under an engine the bus announces the name the game declared, so every entry
 * `cues()` returns is a real cue name. The constant exists so a check written
 * against the engineless project — "no sound came back unnamed" — is one file in
 * three directories, and holds here trivially.
 */
export const UNNAMED_CUE = "?";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, in the order that file introduces them.
 *
 * SHORTER THAN THE ENGINELESS PROJECT'S LIST BY EIGHT NAMES, and the
 * specification is what removes them: `setAutoStep`, `advance`, `project` and the
 * five input operations exist "under this engine only", because nothing outside
 * an engineless build owns its loop, its camera or its keyboard. Here the engine
 * owns all three, so the surface carries no operation for any of them and a build
 * that shipped one would be answering a question it was not asked.
 *
 * A build missing any name below cannot be driven, so every check that reaches
 * for the surface fails with that fault beside what the specification requires —
 * which is the verdict `specs/instrumentation.md` asks for, since the surface is
 * a deliverable rather than a convenience.
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
 * What a check requires of the build when it finds no usable surface.
 *
 * The `none` project's phrasing names `window.__gantry`, because that is where
 * that engine's specification puts the surface. Here the specification puts it on
 * the value the instance's `initialize` returns, so that is what the reviewer is
 * shown.
 */
export const SURFACE_REQUIREMENT =
  "a usable debug and automation surface returned from the game instance's " +
  "initialize and held by the engine as `engine.debug`, carrying every " +
  "operation specs/instrumentation.md requires";

/** Fail the running check on a fault, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* The figures a drive is counted in                                          */
/* -------------------------------------------------------------------------- */

export { TICK_HZ };

/** Seconds one tick covers, and milliseconds. */
export const TICK_DT = 1 / TICK_HZ;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of run clock in `count` ticks. */
export function seconds(count: number): number {
  return count / TICK_HZ;
}

/** Whole ticks covering `duration` seconds of run clock. */
export function ticks(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/** The same reading under the name the shared harness also gives it. */
export const ticksFor = ticks;

/** A speed in units per second from a displacement measured over `count` ticks. */
export function speedOverTicks(distance: number, count: number): number {
  return (Math.abs(distance) * TICK_HZ) / count;
}

/** A rate per second from a gain measured over `count` ticks. */
export function gainOverTicks(gain: number, count: number): number {
  return (gain * TICK_HZ) / count;
}

/** How the logical stage is mapped onto a canvas of that CSS size. */
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  cssScale: number;
  cssOffsetX: number;
  cssOffsetY: number;
}

/**
 * The letterboxed fit of Gantry's stage onto a canvas of that CSS size.
 *
 * The same arithmetic the engine's own viewport does, stated here so a check
 * about the fit has the figure the specification implies to compare against
 * rather than the one the engine computed.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const cssScale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H);
  const scale = cssScale * dpr;
  return {
    width: STAGE_W,
    height: STAGE_H,
    scale,
    offsetX: (deviceWidth - STAGE_W * scale) / 2,
    offsetY: (deviceHeight - STAGE_H * scale) / 2,
    cssScale,
    cssOffsetX: (cssWidth - STAGE_W * cssScale) / 2,
    cssOffsetY: (cssHeight - STAGE_H * cssScale) / 2,
  };
}

/* -------------------------------------------------------------------------- */
/* Where this project sits                                                    */
/* -------------------------------------------------------------------------- */

/** This module's own directory: the case's validator project. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace: the tree `src/`, `assets/` and `dist/` sit in. */
const WORKSPACE_ROOT = dirname(PROJECT_ROOT);

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** The directory the runner stages this project to inside the build's tree. */
const STAGED_PROJECT_DIR = "validation";

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for what its instance's `initialize` returns —
 * the `D` of its `GameDefinition<D>` — and that type is the build's. What a check
 * holds it to is `./surface`, so the definition is cast to the case's shape here
 * and the engine is parameterized with it. A surface that departs from the
 * specification is caught where a check reaches for the missing member, not by
 * the build's own compiler.
 */
const game = build as unknown as GameDefinition<GantryDebugApi>;

/** One cue the build announced, as the engine reported it. */
export interface TimedCue {
  /** The cue's name, one of the twelve `CUES` fixes (`specs/ui.md`). */
  cue: string;
  /** The frame loop's simulated time when it sounded, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it sounded on, 1-based, as `engine.frame().count` reports. */
  frame: number;
  /** Whether it started a loop rather than played once. */
  looped: boolean;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/** What a harness may be built differently from the default. */
export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
  clock?: Clock;
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
 * makes sense under one runtime — that is what lets one suite file grade three of
 * them.
 *
 * The members below the fold are this engine's alone, and only the handful of
 * engine-specific suites `test-case.toml` points here touch them.
 */
export interface Harness {
  /** Destroy the engine this harness held. */
  dispose(): Promise<void>;

  /** Every operation `specs/instrumentation.md` names, each async. */
  readonly debug: GantryDriver;

  /** A fresh read of the game's own state. */
  snapshot(): Promise<GantrySnapshot>;
  /** The static check of `specs/structure.md`, computed on the spot. */
  check(): Promise<CheckResult>;

  /**
   * Run whole simulation ticks, and LEAVE THE WATCH SPEED ALONE.
   *
   * One frame of the harness's clock is `1 / TICK_HZ` seconds, and a run at watch
   * speed `1` consumes exactly one tick of the pipeline `specs/program.md` fixes
   * out of that. A run starts at speed index `0` (`specs/state.md`), which is
   * `RUN_SPEEDS[0]` (`1`), so one call here is one tick — and nothing in this
   * harness ever poses `setSpeedIndex`. A check that is ABOUT the watch speed
   * poses it itself and counts what it counts.
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

  /** Where a world position is drawn, in logical stage units. */
  project(x: number, y: number, z: number): Promise<Projected>;

  /** The cue names announced since the last read, in order, then cleared. */
  cues(): Promise<string[]>;
  /** The cue names of the sounds that are looping right now. */
  loopingCues(): Promise<string[]>;

  /** Keep the picture on screen as the review item's `id` output. */
  capture(id: string, name: string): Promise<void>;

  /* ---- This engine's own, for the few suites that are about it ------------ */

  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /** The engine this harness built, for a check that is about the engine. */
  readonly engine: Engine<GantryDebugApi>;
  /** The world currently open, read fresh on every access. */
  readonly world: World;
  /** The open world's game state: the live `GantryState` the build declared. */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every world. */
  readonly instance: GameInstance<GantryDebugApi>;
  /** The raw surface the build returned, undriven, or `null` when it returned none. */
  readonly surface: GantryDebugApi | null;
  /** Every cue the build announced, oldest first, never drained. */
  readonly played: readonly TimedCue[];
  /** Every asset the build asked for and did not get, oldest first. */
  readonly assetFailures: readonly AssetFailure[];
  /** What the build stood the game up in, before this harness reset it. */
  readonly openingSnapshot: GantrySnapshot | null;
  /** The frames this harness has driven, 1-based, as the engine counts them. */
  tick(): number;
  /**
   * Reflect the surface without invoking it: `typeof` for each name, and the
   * version it reports.
   */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };
}

/* -------------------------------------------------------------------------- */
/* Reaching the build's surface                                               */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in for a surface the build never returned, or returned incomplete:
 * every operation on it fails the check that reached for it, naming the fault.
 *
 * A proxy rather than a hand-written stub, so an operation a check reaches for by
 * name reports the build's missing surface rather than looking like a harness
 * bug. Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
function missingDriver(fault: string): GantryDriver {
  return new Proxy({} as GantryDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      // Async, like every operation the driver carries when there IS one, so a
      // check that awaits the call reads a rejected promise rather than a
      // synchronous throw the shape of its own `await` did not expect.
      return async () => failSurface(fault);
    },
  });
}

/**
 * The build's surface, wrapped so every operation is `async`.
 *
 * THE WHOLE OF THE DIFFERENCE BETWEEN THE THREE PROJECTS' DRIVERS, and it is one
 * line of behaviour: call the operation, hand back its answer as a resolved
 * promise. Under `none` the promise is real, because the call crosses into a
 * page; under `simple-3d` the driver also threads the state through
 * `engine.apply`; here the world is live and the surface acts on it at the call,
 * so there is nothing to do but await nothing. A validator writes
 * `await h.debug.setTool("cable")` in all three.
 *
 * An operation the build did not supply fails the check that reached for it, at
 * the moment it reaches, rather than at construction: a build missing one
 * operation should fail the items that need it and decide the rest.
 */
function driverFor(surface: GantryDebugApi): GantryDriver {
  const held = surface as unknown as Record<string, unknown>;
  const wrapped = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  return new Proxy({} as GantryDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;

      const memoized = wrapped.get(property);
      if (memoized !== undefined) return memoized;

      const operation = held[property];
      if (typeof operation !== "function") {
        return async () =>
          failSurface(
            `engine.debug carries no \`${property}\` operation (it holds ` +
              `${operation === undefined ? "nothing" : typeof operation})`,
          );
      }

      const method = async (...args: unknown[]): Promise<unknown> =>
        (operation as (...rest: unknown[]) => unknown).apply(held, args);
      wrapped.set(property, method);
      return method;
    },
  });
}

/**
 * The debug surface the BUILD's instance returned, read off the engine that holds
 * it, or `null` with the fault named.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its game instance's `initialize` returns it, the engine
 * keeps that same object, and `engine.debug` is the only way it reaches a check.
 * What is decided here is a return that is no surface, or one missing an
 * operation the specification requires. That is a fault in the build and not in
 * this harness, so it must not present as one: it is neither thrown from here —
 * which would bury the verdict under the harness's own stack — nor swallowed.
 */
function readDebugSurface(engine: Engine<GantryDebugApi>): {
  surface: GantryDebugApi | null;
  fault: string | null;
} {
  let held: unknown;
  try {
    held = engine.debug;
  } catch (error) {
    return {
      surface: null,
      fault: `reading engine.debug threw: ${describe(error)}`,
    };
  }

  if (typeof held !== "object" || held === null) {
    return {
      surface: null,
      fault: `engine.debug holds ${held === null ? "null" : typeof held}, not an object`,
    };
  }

  const carried = held as Record<string, unknown>;
  const missing = REQUIRED_OPS.filter(
    (name) => typeof carried[name] !== "function",
  );
  return {
    surface: held as GantryDebugApi,
    fault:
      missing.length === 0
        ? null
        : `engine.debug is missing ${String(missing.length)} required ` +
          `operation${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
  };
}

/** An error's message, for a fault a reviewer reads. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------------------------- */
/* The events this harness dispatches                                         */
/* -------------------------------------------------------------------------- */

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
 * The engine reads `clientX`, `clientY`, `pointerId`, `isPrimary`, `pointerType`,
 * `button` and `buttons`, and maps the position through the same fit the game
 * draws under: the client position, times the device pixel ratio, through the
 * inverse viewport map. At the default shape — the stage's own size at one device
 * pixel per CSS pixel — that map is the identity, so a logical point is
 * dispatched directly.
 *
 * `button` and `buttons` say which button the sample is about and which are held
 * once it has been applied. A move reports `-1`, which is the field saying the
 * event is about position rather than about a button, exactly as a browser's is.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId = 1;
  readonly isPrimary = true;
  readonly pointerType = "mouse";
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    button: number,
    buttons: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.button = button;
    this.buttons = buttons;
  }
}

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/** How long a drive may hold the worker's event loop before it lets a turn by. */
const YIELD_AFTER_MS = 100;
let yieldedAt = Date.now();

/**
 * Stand an engine up over canvases of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options handed to the factory are the ones the seeded `src/main.ts` hands
 * it — the logical stage size, the touch layout, the asset root and the shadow
 * switch — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 *
 * TWO THINGS THE BUILD'S OWN `main.ts` PASSES AND THIS DOES NOT. The `background`
 * colour, because it is a value the build exports and this harness compiles
 * against as little of the build as it can: the clear colour reaches nothing a
 * validator can read, so making the harness fail to compile over it would trade a
 * decided item for an undecided run. And the page's canvas, because there is no
 * page; the two this harness makes are described in `./host.ts`.
 *
 * A FAILED INITIALIZATION IS A VERDICT, NOT A CRASH. `engine.initialize` rejects
 * when the instance's `initialize`, the level's `load`, or a `beginPlay` throws,
 * and every one of those is the build's code. The rejection is caught and kept as
 * {@link Harness.surfaceFault}, so each check that reaches the game fails with
 * that cause beside what the specification requires, and the run reaches a
 * verdict on every item rather than reporting a broken suite.
 *
 * THE OPENING SNAPSHOT IS READ BEFORE THE RESET. `specs/ui.md` says of the title
 * screen "The game opens on `title`", which is a fact about what a FRESH game
 * opens on rather than about what a `reset` puts back — and every check runs after
 * this harness's opening reset, so that half of the requirement would be
 * invisible without a reading taken first.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  // Two of the three gaps Node leaves, filled before a line of the engine or the
  // build runs: the produced files answerable over `fetch`, and an audio context
  // to decode them through. Both are idempotent and both are per worker; the
  // third — the canvases and the WebGL2 context — is `createEngineSurface` below.
  serveWorkspaceAssets(WORKSPACE_ROOT);
  defineAudioContext();

  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  const host: EngineSurface = createEngineSurface(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => host.events,
  };

  const engine = createEngine<GantryDebugApi>({
    canvas: host.stage,
    screen: host.screen,
    // The logical design size of `specs/overview.md`, which is what every figure
    // a check states a stage position in is measured in.
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The two `src/main.ts` passes that decide how the game is stood up rather
    // than how it looks: the keyboard vocabulary the touch layout brings with it,
    // and the one root every produced file resolves under (`specs/assets.md`).
    layout: LAYOUT,
    assetRoot: ASSET_ROOT,
    // Shadow maps, which can only be asked for at construction. A light casts and
    // a surface receives only where the game says so, so this costs a build that
    // wants none of it nothing, and a build that declared a caster would draw
    // differently without it.
    shadows: true,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface: metrics,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its opening cues observable: construction runs no game code, so nothing
  // has happened yet.
  const played: TimedCue[] = [];
  const assetFailures: AssetFailure[] = [];
  let drained = 0;
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: engine.frame().count, looped: false });
  });
  engine.events.on("cue:looped", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: engine.frame().count, looped: true });
  });

  // EVERYTHING THE BUILD COULD GET WRONG IS SETTLED HERE, ONCE, and then frozen
  // into the constants the readings below close over. `engine.initialize` rejects
  // when the instance's `initialize`, the level's `load`, or a `beginPlay` throws,
  // and every one of those is the build's code; `engine.debug` may hold no
  // surface, or one missing an operation; and the surface's own `snapshot` may
  // throw the first time it is read. Each of those is the build's fault and none
  // of them is this harness's, so each becomes a FAULT a check fails on rather
  // than an exception a suite dies of.
  let started: GameInstance<GantryDebugApi> | null = null;
  let found: GantryDebugApi | null = null;
  let problem: string | null = null;
  let opening: GantrySnapshot | null = null;

  try {
    started = await engine.initialize();
  } catch (error) {
    problem = `engine.initialize() rejected: ${describe(error)}`;
  }

  if (problem === null) {
    const read = readDebugSurface(engine);
    found = read.surface;
    problem = read.fault;
  }

  // The game as the BUILD stood it up, before anything here touched it. Read only
  // where the surface can be read at all; a build with no surface has no opening
  // state to report, and every check about one fails on the surface instead.
  if (problem === null && found !== null) {
    try {
      opening = found.snapshot();
    } catch (error) {
      problem = `engine.debug.snapshot() threw: ${describe(error)}`;
    }
  }

  const fault = problem;
  const surface = fault === null ? found : null;
  const instance = fault === null ? started : null;
  const openingSnapshot = opening;

  const debug =
    surface === null
      ? missingDriver(fault ?? "engine.debug holds no surface")
      : driverFor(surface);

  /** Fail whatever a check asked of a build whose game did not come up. */
  const refuse: () => never = () =>
    failSurface(fault ?? "the engine did not start");

  // The pointer's last position, in logical stage units, because
  // `specs/instrumentation.md` states a release as happening "at the position the
  // pointer is at" and a dispatched pointer event has to carry one.
  let pointerAt = { x: 0, y: 0 };
  let pressLive = false;

  const dispatch = (event: Event): void => {
    if (surface === null) refuse();
    host.events.dispatchEvent(event);
  };

  const step = async (count: number): Promise<void> => {
    if (surface === null) refuse();
    // WHY A DRIVE HANDS THE EVENT LOOP A TURN. `engine.advance(n)` returns a
    // promise, but the `n` frames have already run by the time it does: the
    // engine steps them synchronously and resolves after the last one. So a check
    // that drives a tape to its end holds this worker's event loop for as long as
    // that simulation takes, and awaiting an already-settled promise does not give
    // the loop back — it queues a microtask, which runs before the loop is reached
    // at all. Vitest reports a running file to its runner over a socket served by
    // that same loop, and a report left unanswered for long enough is abandoned,
    // which spoils the RUN over a check that passed. So one real turn of the loop
    // is let through whenever the frames just run have held it for
    // `YIELD_AFTER_MS`. Nothing measured here depends on wall-clock time — every
    // check supplies its own clock and the engine reads no other — so the turn
    // changes no reading.
    await engine.advance(count);
    if (Date.now() - yieldedAt >= YIELD_AFTER_MS) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      yieldedAt = Date.now();
    }
  };

  const harness: Harness = {
    async dispose() {
      engine.destroy();
    },

    debug,

    async snapshot() {
      if (surface === null) refuse();
      return surface.snapshot();
    },
    async check() {
      if (surface === null) refuse();
      return surface.check();
    },

    advance: (count = 1) => step(count),

    async keyDown(code) {
      dispatch(new KeyEvent("keydown", code));
    },
    async keyUp(code) {
      dispatch(new KeyEvent("keyup", code));
    },

    async press(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press
      // the game can actually see: the engine arms an action's edge when the key
      // goes down and DISCARDS every edge no controller consumed by the end of
      // the frame it was armed in, so a press with no frame inside it would never
      // reach the game at all. `specs/instrumentation.md` says the same thing from
      // the other side: "a caller that needs the game to have consumed one runs a
      // frame after it."
      await harness.keyDown(code);
      await step(1);
      await harness.keyUp(code);
    },

    async pointerMove(x, y) {
      pointerAt = { x, y };
      dispatch(new PointerEvt("pointermove", x, y, -1, pressLive ? 1 : 0));
    },
    async pointerDown(x, y) {
      // It moves the pointer there first, so a press needs no `pointerMove`
      // before it (`specs/instrumentation.md`). The engine reads the position off
      // the press itself, so the one event carries both.
      pointerAt = { x, y };
      pressLive = true;
      dispatch(new PointerEvt("pointerdown", x, y, 0, 1));
    },
    async pointerUp() {
      pressLive = false;
      dispatch(new PointerEvt("pointerup", pointerAt.x, pointerAt.y, 0, 0));
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
      await harness.pointerDown(x, y);
      await step(1);
      await harness.pointerUp();
      await step(1);
    },

    async project(x, y, z) {
      if (surface === null) refuse();
      // THE ENGINE'S CAMERA, NOT A DEBUG OPERATION. `world.camera.worldToLogical`
      // answers "the logical point a world point draws at, through the camera as
      // it stands at the call", in the same coordinates the screen layer draws
      // in — which is exactly what `specs/instrumentation.md` asks `project` for
      // under `none`, minus the `depth` that only this engine reports. `visible`
      // is the engine's frustum test, which is "in front of the camera and inside
      // the stage" stated the way a frustum states it.
      const at = engine.world.camera.worldToLogical({ x, y, z });
      return { x: at.x, y: at.y, visible: at.visible };
    },

    async cues() {
      if (surface === null) refuse();
      const names = played.slice(drained).map((entry) => entry.cue);
      drained = played.length;
      return names;
    },
    async loopingCues() {
      if (surface === null) refuse();
      const audio = engine.world.audio;
      return CUES.filter((cue) => audio.looping(cue));
    },

    async capture(id, name) {
      captureStill(harness, id);
      console.log(`gantry: captured ${id} — ${name}`);
    },

    surfaceFault: fault,
    engine,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    get instance() {
      if (instance === null) refuse();
      return instance;
    },
    surface,
    played,
    assetFailures,
    openingSnapshot,
    tick: () => engine.frame().count,

    probe(names) {
      const target = (found ?? {}) as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const op of names) ops[op] = typeof target[op];
      return { version: target.version, ops };
    },
  };

  screens.set(harness, host.screenCanvas);

  // The opening reset, so every check starts from the state
  // `specs/instrumentation.md` says a `reset` leaves: the title screen, site `0`
  // open, nothing cleared, an idle run, `simTime` `0`. It runs after the opening
  // snapshot was taken, which is the one reading that is about what came before
  // it.
  if (surface !== null) await harness.debug.reset();

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence for the reviewer                                                  */
/* -------------------------------------------------------------------------- */

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
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/**
 * Keep the frame currently drawn as the review item's `outputId` output.
 *
 * WHAT A STILL HOLDS HERE, PLAINLY. The engine draws the yard through WebGL and
 * composites its 2D screen layer over the result; this project runs in Node, and
 * the only one of those two surfaces Node can rasterize is the screen layer. So
 * the picture written is the layer the readouts, the menus, the tape and the
 * diagnostics overlay are drawn on, over transparency where the yard would be. It
 * is real evidence about half the frame and no evidence at all about the other
 * half, and a review item whose verdict rests on the 3D picture wants a reviewer
 * looking at the built site rather than at this.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, screenOf(h).toBuffer("image/png"));
  } catch (error) {
    console.warn(`gantry: could not write ${destination}: ${describe(error)}`);
  }
}

/** The screen layer this harness handed its engine. */
function screenOf(h: Harness): Canvas {
  const held = screens.get(h);
  if (held === undefined) {
    throw new Error(
      "gantry: this harness was not built by createHarness(), so the screen " +
        "layer it drew on is missing",
    );
  }
  return held;
}

/**
 * The screen canvas behind each harness.
 *
 * Held here rather than exposed on {@link Harness}, because the engineless
 * project has no such thing and a helper that reached for it would stop being one
 * file in three directories.
 */
const screens = new WeakMap<Harness, Canvas>();

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
 * inside the reference build, which is not what a run produces. Read at module
 * load with `readFileSync` rather than imported as JSON, because the workspace's
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
 * carries, so a scenario that just needs a crane to exist costs twenty-one poses
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
// Each of these poses a situation through `engine.debug` and then lets the real
// simulation run. Nothing here fabricates an outcome: a pose "establishes a
// precondition and never an outcome; what happens next comes from advancing the
// real simulation" (`specs/instrumentation.md`).
//
// EVERY ONE OF THEM IS THE SAME FUNCTION, WITH THE SAME BODY, AS THE ENGINELESS
// PROJECT'S. They are written against `h.debug` and `h.snapshot` alone, which is
// exactly the surface a validator has, so a sequence that reads correctly in one
// directory reads correctly in all three.

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

  let count = 0;
  while (count < maxTicks) {
    await h.advance(1);
    count += 1;
    snapshot = await h.snapshot();
    if (predicate(snapshot)) return snapshot;
  }

  fail(
    `${what} within ${maxTicks} ticks (${(maxTicks / TICK_HZ).toFixed(2)}s ` +
      "of run clock)",
    `it never held: after ${count} ticks the run is ` +
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
 * press and release at a visible node's projected point picks that node".
 */
export async function nodePoint(h: Harness, node: Vec3): Promise<Projected> {
  return h.project(node.x, node.y, node.z);
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
