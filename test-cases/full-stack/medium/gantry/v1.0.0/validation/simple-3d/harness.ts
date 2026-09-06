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
// THE MACHINERY OF THAT PARAGRAPH IS NOT GANTRY'S. Building an engine over a
// canvas the harness owns, recording what the screen pass drew on it, reading the
// debug surface back off the engine, threading a PURE surface through
// `engine.apply`, stamping the cues the engine announced, serving the build's
// produced files to the engine's loader, decoding a produced `.wav`, standing a
// WebGL2 context up for three's renderer, and writing the evidence a review item
// declares — every ENGINE-backed case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`. What
// is left here is what is genuinely Gantry's: the operations its specification
// requires, which of them are readings, its snapshot and surface types, its stage
// and tick rate, its camera probe, its three-engine `Harness` shape, and the
// compound sequences below.
//
// ONE API, THREE ENGINES. This file exports the same `Harness` interface as
// `validation/none/harness.ts` and `validation/structured-3d/harness.ts`, with
// every operation `async`, so a `<category>/<id>.test.ts` file is byte-identical
// in all three directories. The asynchrony is REAL under `none` — each call
// crosses into Chromium — and vacuous here, which costs this harness nothing and
// buys one suite instead of three. It is also why this file holds a `Harness` of
// its own rather than handing out the package's `EngineHarness`: the shared one is
// the right shape for a case whose suites are written per engine, and Gantry's are
// written once for three.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`
// (`specs/instrumentation.md`), the engine holds the second element and returns
// it from `engine.debug`, and reading it back off the engine is the only way a
// surface reaches a check. So a build that returned no surface, or a surface
// missing an operation, fails the checks that reach the game through it. See
// {@link drivenSurface}.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what this
// engine's state model forces. The engine holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read
// (`surface.ts`). The package's `applyDriver` supplies the state — a reading is
// handed `engine.state`, a pose is run through `engine.apply` so the state it
// returns is the state the next frame receives — and the `READINGS` list below is
// what tells the two apart, because nothing about a pure surface distinguishes
// them at run time. Every member then answers a promise, because the same
// operation under `none` crosses into a browser and does. Nothing a check does
// holds a writable state.
//
// FOUR THINGS THE ENGINE OWNS THAT `none` PUTS ON THE SURFACE.
// `specs/instrumentation.md` puts the clock, the projection and the raw input on
// the surface UNDER THE ENGINELESS ENGINE ONLY, because nothing outside an
// engineless build owns its loop, its camera or its keyboard. Here the engine
// owns all four and the surface carries no operation for any of them, so the
// harness supplies them from the engine and puts them where a validator expects:
//
//   - `h.advance(n)` is the engine's frame off a `ConstantClock(TICK_MS)`, so
//     one frame covers exactly one simulation tick at watch speed 1;
//   - `h.keyDown`/`h.pointerDown`/… dispatch REAL events at the engine's surface,
//     which the game reads through the actions it registered and the pointer the
//     engine maps into logical stage units;
//   - `h.project` goes through the engine's camera, after the build's own
//     `render` has posed it;
//   - `h.cues()` reads the cues the engine announced.
//
// A validator never learns that any of them was engine-only somewhere else. And
// `project` is NOT the kit's `toLogical`: the package takes a case's logical
// projection as one config value, for mapping a POINTER's logical point onto the
// canvas, where Gantry's `project` maps a WORLD position — three coordinates —
// onto the stage. So `toLogical` is left at the identity, which is what a logical
// stage point already is here.
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
// runs in Node, and the engine is written for a browser. All three stand-ins are
// the package's now: `defineSelfForThree` gives three's renderer the `self` it
// disposes through, `createGlStub` gives the engine the `webgl2` context it takes
// the moment it is created, `installAssetHost` serves the produced files off the
// workspace the way a page serves them, and `installAudioContext` decodes a
// produced `.wav` so a build that binds its cues to files still initializes. None
// of them changes what the game computes; each one supplies a browser facility the
// build is entitled to assume, and `specs/instrumentation.md` is what makes that
// sound: "Game state advances from ticks and input alone, independent of the
// canvas, of the renderer, and of wall-clock time."
//
// AND ONE THING NOTHING STANDS IN FOR: A RECORDING. `engines/simple-3d` records a
// scene as VP9 video, which wants a browser's encoder, and `emitReplay` is a
// browser command — so a project that runs in Node reaches neither, and the
// package says the same thing about every 3D case in the header of
// `case-harness/engine/3d`. Every point this case declares is therefore backed by
// a STILL, including the ones whose subject is a stretch of motion rather than a
// posed arrangement: a swing, a cable snapping, a breakage cascading into a
// collapse. A reviewer would rather watch those than read one frame of them, and
// here there is one frame.
//
// WHAT IT WOULD TAKE, stated so the next reader does not have to work it out
// again: browser mode with the Playwright provider, and then the canvases, the
// `webgl2` context, the asset transport, the audio decoder and every still written
// through `node:fs` all move with it, because each of them is built for this
// process. That is not a dial on this file, it is a different file — and the suite
// would then pay a browser's wall clock against the budget the node choice was
// made for. It is left undone deliberately rather than half-done.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  applyViewport,
  ConstantClock,
  createEngine,
  type Clock,
  type DeepReadonly,
  type Engine,
  type Game,
  type RenderApi,
  type SurfaceMetrics,
} from "@clockwyrks/simple-3d";
import * as THREE from "three";

import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import {
  applyDriver,
  breathe,
  captureOutput,
  createEngineCaseHarness,
  installAssetHost,
  installAudioContext,
  missingOps,
  promiseDriver,
  silentAudioBuffer,
  type AssetHost,
  type AudioBufferLike,
  type EngineCaseKit,
  type EngineHarness,
  type TimedCue,
} from "./case-harness/engine/index";
import { createGlStub, defineSelfForThree } from "./case-harness/engine/3d";
import type { DrawCall, RecordedOp } from "./case-harness/draw-calls";
import {
  ASSET_ROOT,
  LAYOUT,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  UNBOUND_KEY,
} from "./constants";
import type {
  DrawnEntry,
  AxisName,
  CheckResult,
  GantryDebugApi,
  GantryDriver,
  GantrySnapshot,
  GantryState,
  LoadClass,
  LoadPose,
  MaterialName,
  MenuRect,
  Projected,
  Screen,
  TapeAction,
  Vec3,
} from "./surface";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

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
 */
export const REQUIRED_OPS = [
  "snapshot",
  "check",
  "drawn",
  "menuItemRect",
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
  "showCheck",
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
 * The operations of the surface that are READINGS rather than poses.
 *
 * The driver has to tell the two apart to know whether an operation goes through
 * `engine.apply` or is handed `engine.state`, and the specification is what
 * separates them: "Readings" is a section of `specs/instrumentation.md` and it
 * holds exactly these under this engine, `project` having gone to the engine.
 *
 * `menuItemRect` is the one of the four that takes an argument of its own past
 * the state — its pure form is `(state, index) => MenuRect` — and the package's
 * driver forwards it, so a check reads the entry it named rather than entry zero.
 */
export const READINGS: readonly string[] = [
  "snapshot",
  "check",
  "drawn",
  "menuItemRect",
];

/**
 * What `cues()` reports a sound it could not name as.
 *
 * NEVER PRODUCED HERE, and it is exported all the same. Under `none` the cue
 * names come from that project's own probe over the produced `.wav` files, which
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
/* The project's own directory                                                */
/* -------------------------------------------------------------------------- */

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/simple-3d/`, and the `validation/` the runner stages
 * that directory to inside the build's tree. It is never taken from the package,
 * which is staged one directory deeper: a still is addressed by the running
 * suite's path relative to the project root, so a root taken from there would
 * address every output one level too deep — and silently, because a writer that
 * raised on a failed write would blame the build for the host's problem.
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

/** The engine this project stands a build up on. */
type GantryEngine = Engine<GantryState, GantryDebugApi>;

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

/**
 * One cue the build played, stamped with the frame it sounded on.
 *
 * The package's, which is a SUPERSET of what this project used to declare and of
 * what `validation/structured-3d/harness.ts` declares: the two disagreed about
 * whether a cue carries `looped` at all, and the package carries it plus the same
 * count under both `frame` and `tick`. Nothing that read the old shape reads
 * differently through this one.
 */
export type { TimedCue };

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/**
 * One operation a frame made on the screen layer, in the shape
 * `./case-harness/draw-calls` writes one under `none`.
 *
 * The two projects read a build's drawing the same way — "what was called, what
 * was set" — so a check that asks what the build wrote on its readouts reads the
 * same list here as it does there, and `toDrawCall`, `drawnText` and `textDraws`
 * work over it unchanged. It is the package's own type, re-exported, because it
 * is the shape the SUITES declare and cast to, in all three directories.
 */
export type { RecordedOp };

/**
 * One call the package's recorder wrote, as the engineless recorder would have
 * written it.
 *
 * The two records hold the same facts under two spellings — `kind` here, `op`
 * there — because the engineless recorder is injected into a page and writes the
 * console player's replay format. Renaming the discriminant is the whole of the
 * difference: the `text` geometry the package's recorder attached to a measured
 * text call travels with it, and `toDrawCall` carries it back, so a check reads
 * the same measured calls whether it asked for {@link Harness.screenOps} or
 * {@link Harness.screenCalls}.
 */
function recordedOp(call: DrawCall): RecordedOp {
  if (call.kind === "set") {
    return { op: "set", property: call.property, value: call.value };
  }
  const op: RecordedOp = { op: "call", method: call.method, args: call.args };
  if (call.text !== undefined) op.text = call.text;
  return op;
}

/** How a harness's engine is built, where a check wants something other than the default. */

export type { DrawnEntry };

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
  /** A touch contact landing at a logical stage position. */
  touchDown(x: number, y: number): Promise<void>;
  /** The contact lifting, at the position it landed at. */
  touchUp(): Promise<void>;
  /** Land a contact, a tick, lift it, a tick: the tap a finger makes. */
  tap(x: number, y: number): Promise<void>;

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

  /** What the last frame drew (`specs/instrumentation.md`). */
  drawn(): Promise<DrawnEntry[]>;

  /**
   * The diagnostic lines the build has registered with the overlay, as they read
   * right now.
   *
   * `specs/instrumentation.md` § Diagnostics fixes what a build must register,
   * and this is how a check reads it — never off the panel's pixels. Under the
   * two engines the engine keeps the registry and hands back every source's
   * current reading; under no engine the overlay is the build's own, so its lines
   * come back through `drawn()` as the text the frame drew.
   *
   * The overlay must be SHOWN for the engineless reading to carry anything, since
   * a panel that is not drawn draws no text.
   */
  diagnostics(): Promise<string[]>;

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
  readonly engine: GantryEngine;
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
  /**
   * The same frame's operations as the draw calls the package's recorder wrote,
   * each text call carrying the width and alignment it was measured at.
   *
   * THE READING A CHECK TAKES COPY AND FIGURES OFF, on all three engines. The
   * measurement — `recorder: { measureText: true }` in the kit below — is what
   * lets `drawnTextLines` and `drawnTextRuns` (`case-harness/text.ts`) fold a
   * heading a build letter-spaced, one glyph per `fillText`, back into the run
   * it spells; the specification fixes the words and leaves their spacing to
   * the build, so a check reads the runs and never the call split.
   * {@link screenOps} answers the same calls, measurement and all, in the
   * engineless recorder's document; a check that reads copy reads this one
   * because the readers take draw calls.
   */
  screenCalls(): Promise<DrawCall[]>;
  /** The ticks this harness has driven, 1-based, as the engine's frame counter reports. */
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
 * What one harness learned about the build's surface, and the sounds that are
 * still going.
 *
 * Keyed by the ENGINE, because both are learned inside the kit's own factory —
 * the surface when it reads `engine.debug`, the loops as the engine announces
 * them, which has to be subscribed BEFORE `initialize` for the game's opening
 * cues to be observable — and neither moment is one `createHarness` is standing
 * in. Two harnesses in one worker therefore never share a record.
 */
interface EngineRecord {
  /** The surface the build returned, or `null` when `engine.debug` held none. */
  raw: GantryDebugApi | null;
  /** Why it cannot be driven, or `null` when it can. */
  fault: string | null;
  /** The cues that are looping right now, by name. */
  readonly looping: Set<string>;
}

/** The record for each engine this worker has built. */
const records = new WeakMap<object, EngineRecord>();

/** This engine's record, minted empty the first time it is asked for. */
function recordOf(engine: object): EngineRecord {
  const held = records.get(engine);
  if (held !== undefined) return held;
  const fresh: EngineRecord = { raw: null, fault: null, looping: new Set() };
  records.set(engine, fresh);
  return fresh;
}

/**
 * Read the debug surface the BUILD returned beside its state off the engine that
 * holds it, and record what is wrong with it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`, the engine keeps
 * the second element, and `engine.debug` is the only way it reaches a check.
 *
 * A build that returned no pair at all never gets this far, because the engine
 * rejects `initialize` itself and the rejection reaches the check that built the
 * harness with the engine's own message — which is what the package's engine half
 * is written to do, and what every engine project in the tree does. What IS
 * decided here is a pair whose second element is no surface, or one missing an
 * operation. That is a fault in the build and not in this harness, so it must not
 * present as one: it is neither thrown from here — which would bury the verdict
 * under the harness's own stack — nor swallowed.
 *
 * A SURFACE MISSING ONE OPERATION IS STILL DRIVEN HERE, and only the operation
 * that is missing fails. `missingOps` is documented as a reading a case decides
 * where to land, and this project lands it per operation, so a build that shipped
 * forty-one of the forty-two still decides every point that does not need the
 * forty-second. `validation/structured-3d/harness.ts` lands the same reading at
 * the harness, which is the other legitimate design, and the two are recorded as
 * differing.
 */
function readSurface(engine: GantryEngine, record: EngineRecord): void {
  const held: unknown = engine.debug;
  if (typeof held !== "object" || held === null) {
    record.fault = `engine.debug holds ${held === null ? "null" : typeof held}, not an object`;
    return;
  }
  record.raw = held as GantryDebugApi;
  const missing = missingOps(held, REQUIRED_OPS);
  if (missing.length > 0) {
    record.fault =
      `engine.debug is missing ${String(missing.length)} of the operations ` +
      `specs/instrumentation.md names: ${missing.join(", ")}`;
  }
}

/**
 * The imperative, asynchronous reading of the raw surface, over the engine that
 * holds the state.
 *
 * THREE LAYERS, AND EACH IS THERE FOR A DIFFERENT REASON.
 *
 *  1. The package's `applyDriver` supplies the state a pure surface cannot have:
 *     a reading is handed `engine.state`, a pose is run through `engine.apply` so
 *     the engine stores what it returned and the next frame's `update` receives
 *     it, and `READINGS` is what tells the two apart. A pose that returns nothing
 *     is refused by the engine with a message naming the rule.
 *  2. The package's `promiseDriver` makes every member answer a promise, because
 *     the same operation under `none` crosses into a browser and does. Both
 *     wrappings are `async` rather than `Promise.resolve(…)`, so a throw is a
 *     REJECTION and never a synchronous throw: an operation can raise for reasons
 *     the specification states — "An argument outside the domain its operation
 *     states is invalid, and the call fails loudly" — and a check asserting either
 *     with `.rejects` is asserting what it would assert under `none`.
 *  3. This proxy, for the one thing that is Gantry's: a REQUIRED operation the
 *     build did not install fails the check that reached for it with the verdict
 *     `specs/instrumentation.md` asks for, rather than as "h.debug.setTool is not
 *     a function", which reads as a fault in this harness rather than in the
 *     build.
 *
 * It is a proxy, and a lazy one, for the same reason the package's `absentSurface`
 * is: the member is read off the raw surface at the moment a check reaches for it,
 * so a missing surface or a missing operation fails the check that needed it and
 * never the `beforeEach` that built the harness. Anything the surface carries that
 * is not an operation — `version`, or a plain property a build added — is passed
 * through untouched.
 */
function drivenSurface(
  engine: GantryEngine,
  raw: object,
  record: EngineRecord,
): GantryDriver {
  const threaded = promiseDriver<Record<string, unknown>, GantryDriver>(
    applyDriver<
      DeepReadonly<GantryState>,
      GantryState,
      Record<string, unknown>
    >(engine, raw, { readings: READINGS }),
  );
  const required: readonly string[] = REQUIRED_OPS;

  return new Proxy({} as GantryDriver, {
    get: (_target, property): unknown => {
      // Keys that belong to the MACHINERY rather than to a check: awaiting a
      // value probes `then`, and vitest's own error formatting probes symbols and
      // `constructor`. Failing those would replace the verdict with noise from
      // the machinery that was trying to report it.
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;

      const held = record.raw;
      // With no surface at all, every access falls through to the package's
      // stand-in, which fails the check that reached for it.
      if (held !== null) {
        const member = (held as unknown as Record<string, unknown>)[property];
        if (typeof member !== "function") {
          if (!required.includes(property)) return member;
          // `async`, so the failure arrives as a rejection like every other
          // operation's: the contract says each one answers a promise, and a
          // check that wrote `await h.debug.setTool(…)` should not have to know
          // that one of them threw before it could.
          return async (): Promise<never> =>
            failSurface(
              `engine.debug.${property} is ${member === undefined ? "absent" : typeof member}, not a function`,
            );
        }
      }
      return (threaded as unknown as Record<string, unknown>)[property];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* What this host does not have                                               */
/* -------------------------------------------------------------------------- */
//
// Everything below fills in a browser facility the engine is written against and
// Node does not carry. Each one is installed once per worker, reference counted
// and idempotent, and none of them is ever uninstalled: they are additive — an
// absolute URL still reaches the real `fetch`, and a host that already has the
// global keeps it — so nothing outside this project can tell they are there.

/**
 * How a produced `.wav` becomes the buffer the engine's loader is handed.
 *
 * THE HEADER AND NOT THE SAMPLES. Nothing in this process listens — the engine's
 * bus only ever hands the buffer to a source node the package's inert graph
 * silences, and what a check reads about sound is the cue EVENTS, which are the
 * engine's own record rather than the graph's — so the rate, the channel count and
 * the frame count are read out of the file the build committed and the channel
 * data is silence of the right length. A body that is not a RIFF/WAVE rejects,
 * which is the honest verdict on a cue backed by something that is not a wave
 * file.
 *
 * `allowMissingData` is this project's own reading and the one place its decode
 * differs from `validation/structured-3d/harness.ts`: a header with no `data`
 * chunk decodes here as zero frames, where the other three harnesses this came
 * from threw. A zero-length buffer binds the cue and plays nothing, so the
 * difference decides an item about a cue whose file carries a header and no
 * samples, and it is stated rather than folded.
 *
 * Held as ONE function rather than written at the call site because the package
 * refuses a second installation whose `decode` is not the same function: two
 * harnesses in one worker must agree about whether a cue's samples were decoded,
 * or one of them would read silence off every channel with nothing to say so.
 */
const decodeCue = (bytes: Uint8Array): AudioBufferLike =>
  silentAudioBuffer(bytes, { allowMissingData: true });

/**
 * A canvas that yields the `webgl2` context the engine takes the moment it is
 * created, and draws nothing.
 *
 * WHY A STUB AND NOT A REAL CONTEXT. The engine renders through a real
 * `THREE.WebGLRenderer`, and a renderer needs a context to construct over. Node
 * has none, and reaching for a headless GPU would buy the one thing these checks
 * are not about — the scene's pixels — at the cost of a native dependency, a
 * driver, and a result that differs by machine. So the package's stub answers
 * three's queries plausibly and discards its draws: the scene graph, the camera,
 * the `View`, the viewport and the frame order are all real, and only the
 * rasterizer is absent.
 *
 * The element is an `EventTarget` because three attaches its context-lost
 * listeners to the canvas, and it carries no `style`, which the engine's canvas
 * fit explicitly tolerates ("A canvas driven headlessly behind a supplied surface
 * may expose no `style` at all").
 */
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
    this.context ??= createGlStub(this, "Gantry validator stub");
    return this.context;
  }
}

/* -------------------------------------------------------------------------- */
/* Opening a harness                                                          */
/* -------------------------------------------------------------------------- */

/**
 * When this worker last let its event loop turn.
 *
 * WHY A DRIVE HANDS THE EVENT LOOP A TURN. The engine's `advance` returns a
 * promise, but the frames have already run by the time it does: the engine steps
 * them synchronously and resolves after the last one. So a check that drives a
 * reference tape to its end holds this worker's event loop for as long as that
 * simulation takes, and awaiting an already-settled promise does not give the loop
 * back — it queues a microtask, which runs before the loop is reached at all.
 * Vitest reports a running file to its runner over a socket served by that same
 * loop, and a report left unanswered for long enough is abandoned, which spoils
 * the RUN over a check that passed. The package's `breathe` lets one real turn
 * through whenever the frames just run have held the loop long enough. Nothing
 * measured here depends on wall-clock time — the clock is this harness's and the
 * engine reads no other — so the turn changes no reading.
 *
 * Per WORKER rather than per harness, because the loop it is letting turn is.
 */
let yieldedAt = Date.now();

/**
 * The package's engine machinery, bound to Gantry on this engine.
 *
 * The four config members where the engines really differ are each answered here
 * from what THIS engine is:
 *
 *  - `createEngine` stands the engine up over TWO canvases. The kit owns and
 *    records one of them, and it is the SCREEN layer — the readouts, menus, tape
 *    and fail copy are what this project reads and what a still keeps, and they
 *    are drawn on a real 2D context. The stage canvas, whose `webgl2` context is
 *    the package's stub, is {@link StubCanvas} beside it. Overriding the screen's
 *    `getContext` is exactly the seam the engine states — "a suite that wants the
 *    drawing operations rather than the pixels overrides `getContext` on the
 *    canvas it supplies as `screen`, and whatever that returns is the object the
 *    game's `render` is handed" — and the kit's recording canvas already does it.
 *  - `driver` is the APPLY-THREADED strategy, with two layers of this project's
 *    own over it: see {@link drivenSurface}.
 *  - `toLogical` is left at the identity: a pointer's logical stage point IS the
 *    engine's logical point here, and the WORLD projection a check reaches for is
 *    `Harness.project`, which takes three coordinates and is not this.
 *  - `snapshot` reads the raw surface rather than the driver, because the kit's
 *    is synchronous and every member of this project's driver answers a promise.
 *
 * `cueEvents` names both firings, because `h.cues()` reports a loop starting as
 * well as a one-shot playing, exactly as it did before the package carried the
 * stamping.
 */
const kit: EngineCaseKit<GantrySnapshot, GantryDriver, GantryEngine, unknown> =
  createEngineCaseHarness<GantrySnapshot, GantryDriver, GantryEngine>({
    slug: "gantry",
    projectRoot: PROJECT_ROOT,
    stage: { width: STAGE_W, height: STAGE_H },
    tickHz: TICK_HZ,
    surfaceRequirement: SURFACE_REQUIREMENT,
    // Measure every text call, so the calls `h.screenCalls()` answers carry the
    // width and alignment the shared merge rule needs to put a letter-spaced run
    // — one glyph per `fillText` — back together into the copy it spells, as the
    // `none` project asks with `measureText: true`. Without it no two text draws
    // ever coalesce, and a check reading copy off `drawnTextLines` would be
    // reading the raw call split after all.
    recorder: { measureText: true },
    cueEvents: ["cue:played", "cue:looped"],
    defaultClock: () => new ConstantClock(1000 / TICK_HZ),
    createEngine: ({ canvas, clock, surface, shape }) => {
      // three's renderer disposes through `self`, which a bare Node process has
      // none of; see the package's `defineSelfForThree` for what goes wrong.
      defineSelfForThree();
      const stage = new StubCanvas(
        Math.round(shape.cssWidth * shape.dpr),
        Math.round(shape.cssHeight * shape.dpr),
      );
      const engine = createEngine<GantryState, GantryDebugApi>({
        canvas: stage as unknown as HTMLCanvasElement,
        // The kit's own canvas, with its recorder already between the build's
        // readouts and the pixels they land on.
        screen: canvas,
        width: STAGE_W,
        height: STAGE_H,
        game,
        background,
        layout: LAYOUT,
        assetRoot: ASSET_ROOT,
        // Shadow maps, which `src/main.ts` asks for and only `createEngine` can.
        shadows: true,
        clock,
        surface: surface as SurfaceMetrics,
      });
      // Subscribed before `initialize`, so a bed the game starts on the way up is
      // already known to be looping. The kit carries `asset:failed` and the two
      // firings; `cue:stopped` is the one event it does not, because it is the one
      // only this case reads.
      const looping = recordOf(engine).looping;
      engine.events.on("cue:looped", ({ cue }) => looping.add(cue));
      engine.events.on("cue:stopped", ({ cue }) => looping.delete(cue));
      return engine;
    },
    driver: (engine, raw) => {
      const record = recordOf(engine);
      readSurface(engine, record);
      return drivenSurface(engine, raw, record);
    },
    snapshot: (_debug, engine) => {
      const { raw, fault } = recordOf(engine);
      if (raw === null) {
        return failSurface(fault ?? "engine.debug holds no surface");
      }
      return raw.snapshot(engine.state) as GantrySnapshot;
    },
  });

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
//
// `(1000 / TICK_HZ) / 1000` is exactly `1 / TICK_HZ` in IEEE 754 at `TICK_HZ`
// `60`, so a build accumulating the delta it is handed and consuming whole
// `1 / TICK_HZ` ticks from it takes exactly one tick per frame, indefinitely,
// with no drift to accumulate. That equality is what makes `advance(n)` mean `n`
// ticks rather than approximately `n`.
//
// All of it is the package's, bound to this case's rate, so the three projects
// count in one vocabulary rather than three copies of one.

export const {
  TICK_DT,
  TICK_MS,
  seconds,
  ticks,
  ticksFor,
  speedOverTicks,
  gainOverTicks,
} = kit;

export { TICK_HZ };

/**
 * The shared harness underneath each Gantry harness.
 *
 * Held here rather than exposed on {@link Harness}, because the engineless project
 * has no such thing and a helper that reached for it would stop being one file in
 * three directories.
 */
const bases = new WeakMap<
  Harness,
  EngineHarness<GantrySnapshot, GantryDriver, GantryEngine>
>();

/** The shared harness under `h`, or a loud failure if it was not built here. */
function baseOf(
  h: Harness,
): EngineHarness<GantrySnapshot, GantryDriver, GantryEngine> {
  const base = bases.get(h);
  if (base === undefined) {
    throw new Error(
      "gantry: this harness was not built by createHarness(), so the shared " +
        "harness underneath it is missing",
    );
  }
  return base;
}

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
  // The two gaps Node leaves that the engine reaches for on its own account: the
  // produced files answerable over `fetch`, and an audio context to decode them
  // through. `workspaceRoot` comes from THIS file, and never from the package,
  // which is staged one directory deeper: a root derived there would address a
  // tree one level too far down and every produced file would quietly 404 — and a
  // 404 is a verdict about the build.
  const assets: AssetHost = installAssetHost({
    workspaceRoot: WORKSPACE_ROOT,
    // The committed tree first — "every produced file is committed under
    // `ASSET_ROOT`" — then Vite's `public/` and the built `dist/`, which are the
    // two ways `specs/assets.md` leaves a build to arrange for the built site to
    // carry them.
    roots: [".", "public", "dist"],
    label: "gantry",
  });
  installAudioContext({ decode: decodeCue });

  // Where this harness's own traffic starts in the process-wide log. Taken before
  // the engine is built, which is where a build loads what it draws with.
  const requestsFrom = assets.mark();

  const base = await kit.createHarness(options);
  const engine = base.engine;
  const record = recordOf(engine);
  const fault = record.fault;
  const raw = record.raw;

  const openingSnapshot =
    fault === null && raw !== null
      ? (raw.snapshot(engine.state) as GantrySnapshot | null)
      : null;

  // A GENUINE key event, so the engine's audio unlocks exactly as it does for a
  // player. No frame runs around it: `UNBOUND_KEY` is bound to no action, so
  // there is no edge for a frame to deliver and nothing for one to consume.
  base.hold(UNBOUND_KEY);
  base.release(UNBOUND_KEY);

  if (fault === null) await base.debug.reset();

  const step = async (count: number): Promise<void> => {
    // THE FRAMES ARE ADVANCED ONE AT A TIME, and that is what puts a boundary
    // around each of them for the recorder: `h.screenOps()` answers the frame the
    // build last drew, exactly as the engineless project's injected recorder does,
    // and a boundary only exists where one is drawn. Emptying the recorder's list
    // at each boundary is that boundary, and it is also what keeps a thousand-tick
    // run from carrying a million operations nothing will read. The engine runs
    // the same `n` frames off the same clock either way.
    for (let frame = 0; frame < count; frame += 1) {
      base.calls.length = 0;
      await base.advance(1);
    }
    yieldedAt = await breathe(yieldedAt);
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
  // recorded one `capture` keeps.

  const probeCanvas = createCanvas(base.canvas.width, base.canvas.height);
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
  const dpr = base.shape.dpr;
  let pointerX = 0;
  let pointerY = 0;
  // The live contact's landing position, in the window units a dispatched event
  // carries: a lift comes back "at the position it landed at"
  // (`specs/instrumentation.md`).
  let contactAt = { x: 0, y: 0 };
  const onWindow = (x: number, y: number): { x: number; y: number } => {
    const view = base.viewport();
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
    dispatchPointer(base.events, type, at.x, at.y);
  };

  // How much of `base.cues` `h.cues()` has already reported.
  let drained = 0;

  const harness: Harness = {
    async dispose() {
      base.dispose();
    },
    debug: base.debug,

    snapshot: () => base.debug.snapshot(),
    check: () => base.debug.check(),
    diagnostics: async () =>
      engine
        .diagnostics()
        .map((reading) => `${reading.name} ${String(reading.value)}`),
    drawn: () => base.debug.drawn() as Promise<DrawnEntry[]>,

    advance: (count = 1) => step(count),

    async keyDown(code) {
      base.hold(code);
    },
    async keyUp(code) {
      base.release(code);
    },

    async press(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press
      // the build can actually see: the engine arms an edge when the event
      // arrives and discards it at the end of the frame that did not consume it,
      // so a tap that ran no frame would never reach the game, and an action read
      // as a LEVEL is only held if a frame runs while the key is down.
      base.hold(code);
      await step(1);
      base.release(code);
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
      dispatchPointer(base.events, "pointerup", pointerX, pointerY);
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

    // A CONTACT, NOT THE MOUSE. `specs/controls.md` has a touch contact arrive
    // on the engine's own pointer reads, told apart by its device, so it is
    // delivered as a pointer event carrying `pointerType: "touch"` and the
    // engine's contact bookkeeping (`input.md`: "A touch or a pen in contact
    // holds `primary`") applies unchanged.
    async touchDown(x, y) {
      const at = onWindow(x, y);
      contactAt = { x: at.x, y: at.y };
      dispatchPointer(base.events, "pointerdown", at.x, at.y, "touch");
    },
    async touchUp() {
      dispatchPointer(
        base.events,
        "pointerup",
        contactAt.x,
        contactAt.y,
        "touch",
      );
    },

    async tap(x, y) {
      // The landing, a tick, the lift, a tick: the same bracketing `click`
      // uses, so a build that reads its input once a frame sees both edges.
      await this.touchDown(x, y);
      await step(1);
      await this.touchUp();
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
      const names = base.cues.slice(drained).map((one) => one.cue);
      drained = base.cues.length;
      return names;
    },
    async loopingCues() {
      return [...record.looping];
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

    engine,
    get state() {
      return engine.state;
    },
    surfaceFault: fault,
    openingSnapshot,
    playedCues: base.cues,
    assetFailures: base.assetFailures,
    // OFF-ORIGIN REQUESTS ARE LEFT OUT, and that is what this reading has always
    // meant: it answers the paths the build asked the SITE for, and `found` says
    // whether the workspace carried one. The package's transport also records what
    // it handed to the platform's own `fetch`, which is a different question and
    // one no point here asks.
    assetRequests: () =>
      assets
        .requestsSince(requestsFrom)
        .filter((one) => !one.offOrigin)
        .map((one) => ({ path: one.url, found: one.status === 200 })),
    screen: base.canvas,
    async screenOps() {
      return base.calls.map(recordedOp);
    },
    async screenCalls() {
      return [...base.calls];
    },
    tick: () => base.tick(),

    probe(names) {
      const target = (raw ?? {}) as unknown as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof target[name];
      return { version: target["version"], ops };
    },
  };

  bases.set(harness, base);
  return harness;
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
// the target the harness owns. Nothing is bypassed — the bindings, the edges, the
// pointer map, the click and orbit rules and the screen restrictions all run
// exactly as they do for a player.
//
// THE KEY EVENT IS THE PACKAGE'S — `h.keyDown` and `h.keyUp` are `base.hold` and
// `base.release`, which dispatch a `KeyEvent` carrying `code` and `repeat`, which
// is every field any of the four engines reads off one. THE POINTER EVENT IS NOT.

/**
 * A `PointerEvent`-shaped event.
 *
 * THE CASE'S OWN, and not the package's `DevicePointerEvent`, which is the same
 * event with two fields decided differently: it states a `buttons` MASK on every
 * event, and reports `button` `0` on a press and a release alike. `pointer.md` is
 * explicit that a mask stated by hand is the wrong answer here: `buttons` "is
 * `null` when the event carried no mask, which a hand-dispatched event commonly
 * does… a press adds its button, a move changes nothing, and a release drops the
 * button it names." That is exactly the bookkeeping a caller wants, and stating a
 * mask by hand is how a dispatched drag ends up holding a button it already
 * released.
 *
 * The engine reads `clientX`, `clientY`, `pointerId`, `pointerType`, `isPrimary`
 * and `button`, and maps the position through the same fit the game draws under:
 * the client position less the surface's origin, times the device pixel ratio,
 * through the inverse viewport. At this harness's default shape — the stage's own
 * size at one device pixel per CSS pixel, over a surface that reports no origin —
 * that map is the identity, so a logical stage point is dispatched directly.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerId: number;
  readonly pointerType: "mouse" | "touch";
  readonly button = 0;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device: "mouse" | "touch" = "mouse",
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = device;
    // A finger is a pointer of its own, so it carries an id the mouse never
    // does: `input.md` tracks each pointer by `id` and "among touches the first
    // one down is" the primary.
    this.pointerId = device === "touch" ? 1 : 0;
  }
}

function dispatchPointer(
  events: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  device: "mouse" | "touch" = "mouse",
): void {
  events.dispatchEvent(new PointerEvt(type, x, y, device));
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Keep the picture on screen as the review item's `outputId` output.
 *
 * WHAT IS KEPT IS THE SCREEN LAYER, and that is the whole of what this host can
 * give. The 3D picture is rasterized by a GPU driver behind a `webgl2` context,
 * and this process has none: the context the engine renders through
 * ({@link StubCanvas}) answers three's queries and draws nothing, so there are no
 * scene pixels to encode. The screen layer is real — the engine draws it through a
 * genuine 2D rasterizer — so what a reviewer gets is every readout, menu, title
 * and result the build drew over the yard, at the moment the last frame that ran
 * left them, and nothing of the yard itself.
 *
 * ASYNCHRONOUS, and that is a real difference rather than a spelling: this project
 * encodes the canvas rather than buffering it, so there is nothing to hand back
 * until the encoder answers. `validation/structured-3d/harness.ts` writes the same
 * picture through the package's synchronous writer, and the package ships both for
 * exactly that reason.
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
  await captureOutput("gantry", PROJECT_ROOT, outputId, "png", () =>
    baseOf(h).canvas.encode("png"),
  );
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
/* The menus, where the build drew them                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives every menu the pointer and touch as well as the key
// actions, and deliberately leaves the LAYOUT to the build: what it fixes is
// that the build reports each entry's hit region through `menuItemRect`, and
// what the pointer and a contact do over that region. So every helper below
// asks the build where it put the entry and then drives a real gesture there.
// Nothing here knows a menu coordinate, and a build that lays its menus out any
// way it likes passes.

/** Where the build put entry `index` of the menu the screen showing carries. */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  return h.debug.menuItemRect(index);
}

/** The middle of a hit region: where a gesture aimed at that entry lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the pointer onto entry `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<{ x: number; y: number }> {
  const at = rectCenter(await menuRect(h, index));
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  return at;
}

/** Press and release inside entry `index`'s region: the click that takes it. */
export async function clickItem(
  h: Harness,
  index: number,
): Promise<{ x: number; y: number }> {
  const at = rectCenter(await menuRect(h, index));
  await h.click(at.x, at.y);
  return at;
}

/** Land a contact inside entry `index`'s region and lift it there. */
export async function tapItem(
  h: Harness,
  index: number,
): Promise<{ x: number; y: number }> {
  const at = rectCenter(await menuRect(h, index));
  await h.tap(at.x, at.y);
  return at;
}

/**
 * Press inside entry `from`'s region, travel to `to`, and release there.
 *
 * The slide-off affordance: a press begun on one entry and released elsewhere
 * takes nothing (`specs/ui.md`). A check reads that nothing was taken and that
 * the highlight followed the pointer.
 */
export async function slideOffItem(
  h: Harness,
  from: number,
  to: { x: number; y: number } | number,
): Promise<void> {
  const start = rectCenter(await menuRect(h, from));
  const end = typeof to === "number" ? rectCenter(await menuRect(h, to)) : to;
  await h.pointerDown(start.x, start.y);
  await h.advance(1);
  await h.pointerMove(end.x, end.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);
}

/**
 * A stage point inside no entry's region of the menu showing.
 *
 * Found by walking a coarse grid over the stage and keeping the first point
 * every reported region misses, so it holds for any layout a build chooses.
 */
export async function offEveryMenuItem(
  h: Harness,
  count: number,
): Promise<{ x: number; y: number }> {
  const rects: MenuRect[] = [];
  for (let i = 0; i < count; i += 1) rects.push(await menuRect(h, i));
  const holds = (x: number, y: number): boolean =>
    !rects.some(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    );
  for (let y = 8; y < STAGE_H; y += 16) {
    for (let x = 8; x < STAGE_W; x += 16) {
      if (holds(x, y)) return { x, y };
    }
  }
  fail(
    "a stage point inside no menu entry's hit region (specs/ui.md leaves the " +
      "layout to the build, and a menu cannot cover the whole stage)",
    "every point of a 16-pixel grid over the stage fell inside a reported region",
  );
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. Nothing here fabricates an outcome: a pose "establishes a
// precondition and never an outcome; what happens next comes from advancing the
// real simulation" (`specs/instrumentation.md`).

/**
 * Enter a site, leaving the build screen showing.
 *
 * TWO OPERATIONS, COMPOSED HERE. `openSite` carries the effects
 * `specs/state.md` states for opening a site — the site's own loads and
 * obstacles back in the yard, the undo history emptied, the pending node and
 * the shown check cleared, the camera back at its start pose, the run back to
 * its idle placeholder — and leaves the screen exactly as it stands.
 * `setScreen("build")` is the other half, and "the two together are what
 * entering a site from the select screen does" (`specs/instrumentation.md`).
 *
 * It reaches any site whether or not it has been unlocked, which is what lets a
 * check about site five's envelope run without playing four sites to reach it.
 */
export async function openSite(h: Harness, index: number): Promise<void> {
  await h.debug.openSite(index);
  await h.debug.setScreen("build");
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

/* -------------------------------------------------------------------------- */
/* Reading what a frame drew                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The entries of one kind, optionally of one name.
 *
 * `specs/instrumentation.md` has `drawn()` report one entry per thing the last
 * frame put on screen, in no fixed order, and a thing the frame did not draw has
 * no entry at all — so an empty answer here is the reading saying it was not
 * drawn, and every check below reads it that way.
 */
export function entriesOf(
  entries: readonly DrawnEntry[],
  kind: DrawnEntry["kind"],
  name?: string,
): DrawnEntry[] {
  return entries.filter(
    (entry) =>
      entry.kind === kind && (name === undefined || entry.name === name),
  );
}

/** Where an entry was drawn, as a world position. */
export const entryAt = (entry: DrawnEntry): Vec3 => ({
  x: entry.x,
  y: entry.y,
  z: entry.z,
});

/**
 * The entries of a kind drawn within `reach` of a world position.
 *
 * A thing is drawn AT a point rather than exactly on it — a mark sits a little
 * above the surface it marks, a model stands centred on its own footprint — so
 * every check that asks "is this drawn here" asks it with a tolerance, and states
 * the one it used.
 */
export function entriesNear(
  entries: readonly DrawnEntry[],
  at: Vec3,
  reach: number,
  kind?: DrawnEntry["kind"],
  name?: string,
): DrawnEntry[] {
  return entries.filter(
    (entry) =>
      (kind === undefined || entry.kind === kind) &&
      (name === undefined || entry.name === name) &&
      distance3(entryAt(entry), at) <= reach,
  );
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
