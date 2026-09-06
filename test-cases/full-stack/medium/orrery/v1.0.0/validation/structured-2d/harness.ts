// Orrery — the case's half of the validator harness, under the STRUCTURED 2D
// engine. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas it named.
//
// THE MACHINERY THAT DOES THAT IS NOT ORRERY'S. Standing an engine up over a
// canvas the harness owns, recording what a frame drew, reading the debug surface
// off the engine and standing in for one the build never returned, serving the
// build's produced files to the engine's loader, decoding a produced `.wav` far
// enough for a cue to bind, and writing the evidence a review point declares —
// every engine-backed case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`. The
// engine half of it is reached through `./case-harness/engine/index`, plus
// `./case-harness/engine/2d` for the replay stack, which is 2D-only.
//
// WHAT A SUITE HOLDS IS ORRERY'S {@link Harness}, NOT THE KIT'S. Orrery ships
// three validator projects and one review item's suite is the SAME TEXT in all
// three, so every member below carries the same name, the same arguments and the
// same return shape as `validation/none/harness.ts` and
// `validation/structured-2d/harness.ts` expose. That is why every one of them
// answers a PROMISE even where nothing here has anything to wait for: a suite
// that awaited under one engine and did not under another would be two suites.
// The kit is what most of them are implemented over; a suite cannot tell.
//
// THE WORLD IS LIVE, AND THAT IS WHY THE DRIVER IS THIN.
// `specs/instrumentation.md` under this engine has every operation act "on the
// live game at the moment it is called": a pose takes only the arguments its row
// names and returns nothing, and a reading returns plain data. So the driver adds
// exactly one thing — the promise every member of {@link OrreryDriver} answers in
// all three projects — and nothing else stands between a check and the object the
// build returned. That is the package's `promiseDriver`, member for member, and
// it is bound rather than rewritten: `READINGS` is not consulted here for the
// reason it never was, that the two kinds are called identically under this
// engine and only what they answer differs.
//
// (The `simple-2d` project has no such luck and keeps a driver of its own. Its
// engine holds the state by value, so the surface there is PURE and every member
// needs the state threaded through `engine.apply`. The package's `applyDriver`
// does exactly that — but it passes a reading no arguments beyond the state, and
// two of Orrery's readings take arguments, and it answers a value where a suite
// awaits a promise. The README's collision table carries the row.)
//
// Orrery runs in ONE WORLD for the whole session. The game registers a single
// level, never opens another, and every screen is a value of `state.screen`
// (`specs/state.md`), so `engine.world` and `engine.world.state` are the same
// objects from `initialize` to `destroy` — which is what lets this harness expose
// them as live references rather than as snapshots.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// instance's `initialize` returns it, the engine keeps that same object, and
// reading it back off the engine is the only way a surface reaches a check — so a
// build that returned no surface, or one missing an operation, fails the checks
// that reach the game through it. `surface.ts` is the specification as types, and
// it is the only description of the surface this project reads: the build's own
// module for it is never imported. The kit's `readDebugSurface` does the read and
// stands an `absentSurface` in when there is nothing to read, so the fault lands
// on the points whose checks reach the game through the surface rather than on
// the `beforeEach` that built the harness.
//
// THE PRODUCED FILES REALLY LOAD. A bare Node process cannot fetch or decode one,
// so without help every produced sprite and every cue would fail to load and every
// point about them would fail every build ever written — a fact about Node rather
// than about the build. {@link installAssetHost} supplies what a browser gives the
// engine's loader: a `fetch` that reads the file the build committed, a
// `createImageBitmap` that decodes one, and the `document.createElement("canvas")`
// a build composing on a scratch surface reaches for; {@link installAudioContext}
// supplies the `AudioContext` that decodes a produced `.wav` far enough for the
// cue to bind. Every request the loader makes is recorded and then served, so a
// check that needs to know WHICH file the build asked for reads
// {@link Harness.assetRequests} and the load still succeeds.

import {
  createCanvas,
  type Canvas,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type World,
} from "@clockwyrks/structured-2d";
import {
  DevicePointerEvent,
  absentSurface,
  breathe,
  captureOutput,
  createEngineCaseHarness,
  installAssetHost,
  installAudioContext,
  promiseDriver,
  wavAudioBuffer,
} from "./case-harness/engine/index";
import { makeReplayCapture } from "./case-harness/engine/2d";
import { BACKGROUND, game as build } from "../src/game";
import { INERT_KEY, LAYOUT, STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import type { OrreryDriver } from "./driver";
import type { StagePoint } from "./field";
import { PROJECT_ROOT, WORKSPACE } from "./media";
import type { OrrerySnapshot } from "./snapshot";
import { REQUIRED_OPS, type OrrerySurface } from "./surface";
import type { DrawCall } from "./drawing";
import type { Pixel, PixelRect } from "./color";
import { fitViewport, toCss, toDevice, type Viewport } from "./viewport";
import type { TimedCue, UntilOptions, UntilResult } from "./scenario";

export * from "./scenario";
export * from "./media";
export * from "./drawing";
export * from "./color";
export * from "./viewport";
export * from "./snapshot";
export type { OrreryDriver };
export { REQUIRED_OPS };

/** The case's surface, exactly as `surface.ts` specifies it. */
export type OrrerySurfaceOf = OrrerySurface;

/** The engine this project stands a build up on. */
type OrreryEngine = Engine<OrrerySurfaceOf>;

/**
 * The build's game definition, typed against the surface the CASE specifies.
 *
 * The build declares its own `OrreryDebugApi`, and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast here and the
 * engine is parameterized with it. An operation the build spelled differently is
 * caught where a check reaches for it, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<OrrerySurfaceOf>;

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */

/**
 * The transport the engine's asset loader fetches through, and the two decoders
 * behind it.
 *
 * `workspaceRoot` comes from `media.ts` and must never come from the package's
 * own module: the package is staged one directory DEEPER than this file, so a
 * root derived there would address a tree one level too far down and every
 * produced file would quietly 404 — and a 404 is a verdict about the build.
 *
 * The root ORDER is the case's: `specs/assets.md` puts every produced file under
 * `assets/` at the REPOSITORY root and the loader asks for `assets/<path>`, so
 * the workspace itself is looked in first; `public/` and `dist/` follow so a
 * build that staged its tree for Vite is still loading its own committed files
 * rather than nothing.
 *
 * `onMissing: "upstream"` hands a relative URL no root carries to the platform's
 * own `fetch`, which is what this harness has always done — Node then rejects the
 * relative URL, so the load fails with a parse error rather than with a status.
 * `images` and `documentElement` are the two shims a 2D build that draws produced
 * sprites, and may compose them on a scratch canvas, actually needs.
 *
 * INSTALLED ONCE PER WORKER, and never taken down: the shims go onto
 * `globalThis`, the package reference-counts them, and a worker that simply exits
 * leaves them standing. {@link Harness.dispose} clears the REQUEST LOG rather
 * than uninstalling, so a second harness in the same worker still has a transport
 * to load through.
 */
const host = installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: [".", "public", "dist"],
  onMissing: "upstream",
  images: true,
  documentElement: true,
  label: "orrery",
});

// The samples themselves never reach a verdict — nothing here sounds — but the
// decode has to SUCCEED, because the engine's `api.audio.load` binds a cue name
// only once its file decodes, and the cue bus then announces every play.
// `wavAudioBuffer` decodes the channels; `silentAudioBuffer` would bind the same
// names off the header alone and read zero from every sample, and Orrery's audio
// checks read files rather than buffers, so the honest one is the one that really
// decoded what the build committed.
installAudioContext({ decode: wavAudioBuffer });

/* -------------------------------------------------------------------------- */
/* Driving the surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 */
export const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which the " +
  "engine hands back from engine.debug (specs/instrumentation.md)";

/* -------------------------------------------------------------------------- */
/* What one harness keeps as its frames run                                   */
/* -------------------------------------------------------------------------- */

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  /** The path the build asked the loader for. */
  path: string;
  /** What went wrong, as the engine reported it. */
  reason: string;
}

/**
 * Everything one harness accumulates while its engine runs, kept beside the
 * engine that produced it.
 *
 * WHY IT IS NOT SIMPLY A CLOSURE OF {@link createHarness}. The engine's events
 * have to be subscribed BEFORE `initialize`, so that the build's own loading is
 * observable — construction runs no game code, so nothing has happened yet — and
 * the kit reaches `initialize` from inside its own `createHarness`, before this
 * project's has anything to close over. The engine is the one object both sides
 * hold, so it is what the ledger hangs off; a `WeakMap` rather than a field, so
 * nothing of this project's is written onto the engine the build is running on.
 */
interface Ledger {
  /** Where `watchCues` attaches: one array per watcher. */
  readonly cues: TimedCue[][];
  readonly assetFailures: AssetFailure[];
  readonly pageErrors: string[];
  /** Which cues are looping now, and how many loops have ever started. */
  readonly loops: { running: Set<string>; starts: number };
  /** How many cues have sounded in total since the game stood up. */
  played: number;
  /** Frames CLOSED so far, so the frame now running is `frames + 1`. */
  frames: number;
  /** The simulated time those closed frames covered, in milliseconds. */
  timeMs: number;
  /** Why the build's engine could not be initialized, or `null`. */
  surfaceFault: string | null;
  /** The surface the build returned, for the kit's synchronous read of it. */
  raw: OrrerySurfaceOf | null;
}

const ledgers = new WeakMap<object, Ledger>();

/**
 * What this project's harness carries past the kit's neutral contract: this
 * engine's own object model, which a simple engine has none of.
 */
interface WorldModel {
  readonly world: World;
  readonly state: GameState;
  readonly instance: GameInstance<OrrerySurfaceOf> | null;
}

/** The ledger kept beside `engine`, which the kit's own callbacks fill in. */
function ledgerOf(engine: OrreryEngine): Ledger {
  const held = ledgers.get(engine as object);
  if (held === undefined) {
    throw new Error("orrery harness: this engine was built without a ledger");
  }
  return held;
}

/**
 * Record a cue the bus announced, stamped with the frame of the drive it sounded
 * on.
 *
 * A cue raised from INSIDE the frame the harness is running belongs to that
 * frame, which is `frames + 1` while a frame is open because a frame is closed
 * only after `engine.advance` returns. One raised BETWEEN frames belongs to the
 * next one advanced — which is the same expression, and is what `specs/ui.md`
 * requires of an edit a pointer pose committed: "an event raised outside one
 * sounds on the next frame advanced rather than at the call".
 *
 * THIS IS WHY THE KIT'S OWN CUE STAMPING IS NOT USED (`cueEvents: []` below). The
 * kit stamps a cue with the ENGINE's frame counter, which between frames is the
 * frame just CLOSED rather than the next one to open, and it stamps `t` from the
 * engine's accumulated time, which is the time at the END of the running frame
 * rather than at its start. Both are defensible readings and neither is Orrery's,
 * and a check that reads `cuesOnFrame` would move by one frame under either.
 */
function stamp(ledger: Ledger, cue: string, looping: boolean): void {
  ledger.played += 1;
  const entry: TimedCue = {
    frame: ledger.frames + 1,
    t: ledger.timeMs,
    cue,
    looping,
  };
  for (const sink of ledger.cues) sink.push(entry);
}

/* -------------------------------------------------------------------------- */
/* The shared kit, bound to Orrery on this engine                             */
/* -------------------------------------------------------------------------- */

/**
 * The package's engine machinery, bound to Orrery on the simple 2D engine.
 *
 * `projectRoot` comes from `media.ts` and must never come from the package's own
 * module, for the reason the asset host's `workspaceRoot` must not: a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root, and taken from the package it would address every output one
 * level too deep — silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem.
 */
const kit = createEngineCaseHarness<
  OrrerySnapshot,
  OrreryDriver,
  OrreryEngine,
  WorldModel
>({
  slug: "orrery",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // A drawn sprite is identified by the SOURCE it was drawn from rather than by a
  // path — a bundler is free to inline a produced PNG, and that is still the
  // committed file — so a bitmap argument is replaced in the record by an
  // `ImageRef` naming it, and `Harness.imagePixels` reads that source's own pixels
  // back. Text is NOT measured: nothing this project reads places a run about its
  // anchor, so measuring every text call would be paid for on every frame of every
  // check for a reading no suite takes.
  recorder: { internImages: true },
  // Deliberately EMPTY: this project stamps its own cues, on the frame Orrery
  // attributes them to and at the time Orrery measures. See {@link stamp}.
  cueEvents: [],
  // Never reached: `createHarness` always names the clock it built, because
  // `advanceSeconds` retunes it between drives. Declared because the kit requires
  // a default, and declared as the same rate so a harness built any other way
  // steps at `specs/`'s own tick.
  defaultClock: () => new TunableClock(1000 / TICK_HZ),
  createEngine: ({ canvas, clock, surface }) => {
    const engine = createEngine<OrrerySurfaceOf>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background and the four-way layout, handed to the
      // factory exactly as the seeded `src/main.ts` hands them, so one harness
      // serves every build of this case.
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    });
    ledgers.set(engine as object, {
      cues: [],
      assetFailures: [],
      pageErrors: [],
      loops: { running: new Set(), starts: 0 },
      played: 0,
      frames: 0,
      timeMs: 0,
      surfaceFault: null,
      raw: null,
    });
    return engine;
  },
  initialize: async (engine) => {
    const ledger = ledgerOf(engine);

    // Subscribed BEFORE `initialize`, which is what makes the game's own loading
    // observable: construction ran no game code, so nothing has happened yet.
    engine.events.on("asset:failed", ({ path, reason }) => {
      ledger.assetFailures.push({ path, reason });
      ledger.pageErrors.push(`asset "${path}": ${reason}`);
    });
    engine.events.on("cue:played", ({ cue }) => stamp(ledger, cue, false));
    engine.events.on("cue:looped", ({ cue }) => {
      ledger.loops.running.add(cue);
      ledger.loops.starts += 1;
      stamp(ledger, cue, true);
    });
    engine.events.on("cue:stopped", ({ cue }) => {
      ledger.loops.running.delete(cue);
    });

    // A build whose `initialize` throws — because it is unimplemented, or because
    // its own loading raised — is a build no check can drive, and that is a fault
    // to REPORT rather than a hook to fail: the message becomes the surface fault
    // every operation then fails with, so the points whose checks reach the game
    // through the surface carry it and the points that do not are decided on
    // their own merits.
    try {
      return await engine.initialize();
    } catch (error) {
      ledger.surfaceFault =
        error instanceof Error ? error.message : String(error);
      ledger.pageErrors.push(ledger.surfaceFault);
      return null;
    }
  },
  driver: (engine, raw) => {
    const ledger = ledgerOf(engine);
    // The kit already stands an `absentSurface` in for a `debug` that is no
    // object. What it cannot know is that this project turned a REJECTED
    // `initialize` into a fault rather than letting it fail the hook, so the
    // stand-in for that case is built here, naming what the build's own error
    // said instead of naming an absent property.
    const surface =
      ledger.surfaceFault === null
        ? (raw as OrrerySurfaceOf)
        : absentSurface<OrrerySurfaceOf>(
            SURFACE_REQUIREMENT,
            ledger.surfaceFault,
          );
    ledger.raw = surface;
    // The whole of the driver: the raw surface is already imperative, and what a
    // suite needs added to it is the promise it awaits under all three engines.
    return promiseDriver<OrrerySurfaceOf, OrreryDriver>(surface);
  },
  // The kit's own synchronous read, off the raw surface rather than through the
  // driver: every member of {@link OrreryDriver} answers a promise, and the kit's
  // contract is a value. Nothing in this project calls it — `Harness.snapshot` is
  // the promise-answering one every suite drives — and it is answered honestly
  // rather than left to throw, because the kit's sweep is entitled to it.
  snapshot: (_debug, engine) => {
    const raw = ledgerOf(engine).raw as OrrerySurfaceOf;
    return raw.snapshot();
  },
  // Left at the identity, and at "exact". Orrery's one world never moves its
  // camera — `specs/overview.md` fits the whole stage into the surface and the
  // game draws in stage units — so a logical point is the engine's, and a raised
  // gesture lands exactly where the caller asked rather than on the nearest
  // device pixel.
  pointerPrecision: "exact",
  // Where this harness reaches PAST the neutral contract into this engine's own
  // object model, which a simple engine has none of. Getters, so `h.world` reads
  // fresh on every access rather than freezing the world open at the moment the
  // harness was built.
  extend: (_base, engine, initialized) => ({
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance: initialized as GameInstance<OrrerySurfaceOf> | null,
  }),
});

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How a harness opens, and what it steps in by default. */
export interface HarnessOptions {
  /**
   * The length of one frame at the harness's own clock, in milliseconds.
   * Defaults to `1000 / TICK_HZ`. {@link Harness.advanceSeconds} overrides it for
   * the frames it runs, so a check about a fraction of a cycle names the span
   * rather than the frame.
   */
  frameMs?: number;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/**
 * Everything a check reads off one engine running this build.
 *
 * THE PORTABLE CORE IS EVERYTHING DOWN TO {@link dispose}, and every member of it
 * carries the same name, arguments and return shape in all three of Orrery's
 * validator projects. Below that sit the members that are this project's alone,
 * because an in-process engine is: {@link engine}, {@link state}, {@link canvas}
 * and {@link ctx}.
 */
export interface Harness {
  /** The surface the BUILD returned, driven over the state the engine holds. */
  readonly debug: OrreryDriver;
  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /** Where `watchCues` attaches: one array per watcher. */
  readonly cues: TimedCue[][];
  /** Every produced file the build asked for and did not get, oldest first. */
  readonly assetFailures: AssetFailure[];
  /**
   * Every produced file the build asked for, oldest first, and each one served.
   *
   * WHAT THE BUILD REACHED FOR is a reading in its own right: a point about
   * which of two committed files the game runs is decided by which of them the
   * build requested, and nothing about the request is interfered with. A path
   * appears here whether its load went on to succeed or not, so a file named
   * here and named in {@link assetFailures} is one the build asked for and did
   * not get.
   */
  assetRequests(): Promise<string[]>;
  /** Everything the runtime reported as an error, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<OrrerySnapshot>;
  /** Run `frames` frames back to back, one at a time. */
  advance(frames?: number): Promise<void>;
  /**
   * Run `frames` whole frames covering exactly `seconds` of game time.
   *
   * The primitive every cycle helper is built on. A run "advances the fraction by
   * `SPEEDS[sim.speed] * dt` cycles" (`specs/simulation.md`), so a span of game
   * time is what names a cycle or a fraction of one exactly, at any speed step and
   * whatever the division.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** The same drive as {@link advance}, answering the state the frames left. */
  step(frames?: number): Promise<OrrerySnapshot>;
  /**
   * Run `frames` frames in one batched call.
   *
   * The same real frames and the same result; what it saves is the per-frame
   * bookkeeping. Under this engine every frame still reaches a live recording, so
   * a march spends a capture's budget here where under no engine it does not — a
   * difference that reaches the EVIDENCE alone and never a verdict.
   */
  skip(frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: OrrerySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Run one frame at a time, handing each frame's snapshot to `watch`. */
  stepWatching(
    count: number,
    watch?: (snapshot: OrrerySnapshot, frame: number) => boolean,
  ): Promise<OrrerySnapshot[]>;
  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /** Press a key, run the one frame that delivers it, and release it. */
  tap(code: string): Promise<OrrerySnapshot>;
  /** Hold `code` for `frames` frames, then release it. */
  holdFor(code: string, frames: number): Promise<OrrerySnapshot>;

  /**
   * Press the REAL pointer at a logical stage point, and run the frame that reads
   * it.
   *
   * The slow sibling of the surface's `pointerDown`, and for the same reason it is
   * under no engine: a pose resolves at the CALL, and a cue is played "on the
   * frame its event happens, from `update`" (`specs/ui.md`), so a check whose
   * subject is what a FRAME did with a player's gesture drives the engine's own
   * pointer input, one frame per sample.
   */
  mousePress(x: number, y: number): Promise<void>;
  /** Move the held pointer to a logical stage point, and run the frame that reads it. */
  mouseGlide(x: number, y: number): Promise<void>;
  /** Release the real pointer, and run the frame that reads it. */
  mouseRelease(): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last frame's render issued, without driving one. */
  lastCalls(): Promise<DrawCall[]>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): StagePoint;
  /** Where a logical point lands in CSS pixels. */
  css(x: number, y: number): StagePoint;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once. */
  pixels(points: readonly StagePoint[]): Promise<Pixel[]>;
  /** A rectangle of the canvas, addressed in logical units, read back as RGBA. */
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
  /** The RGBA bytes of a source a frame drew, by its `ImageRef` id. */
  imagePixels(id: number): Promise<PixelRect | null>;
  /** The canvas's backing store size. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /**
   * Open the build's audio.
   *
   * Under this engine the unlock is the engine's and a headless process has no
   * gesture to give it, so this raises the key event the engine unlocks from. It
   * changes no game state.
   */
  armAudio(): Promise<void>;
  /** How many cues the build has played since the game stood up, in total. */
  sounds(): Promise<number>;
  /** How many cues are LOOPING now: started by `loop` and not yet stopped. */
  loopingSounds(): Promise<number>;
  /** How many loops have been started, whether or not they are still running. */
  loopStarts(): Promise<number>;
  /** Reflect the surface without invoking it: `typeof` for each name, and `version`. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): Promise<void>;

  /* -- This project's own, past the portable core -------------------------- */

  /** The engine this harness built. */
  readonly engine: OrreryEngine;
  /** The world currently open, read fresh on every access. */
  readonly world: World;
  /**
   * The open world's game state — the live `OrreryState` `specs/state.md`
   * declares — read fresh on every access.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<OrrerySurfaceOf> | null;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** The real 2D context, for a reading `pixelRect` does not carry. */
  readonly ctx: SKRSContext2D;
}

/**
 * A clock whose frame length this harness retunes between drives.
 *
 * ORRERY'S OWN, AND NOT THE PACKAGE'S `ConstantClock`. {@link
 * Harness.advanceSeconds} names a SPAN of game time and a number of frames to
 * cover it with, so the delta a frame is worth is decided per drive rather than
 * per harness — which is what makes a check about a fraction of a cycle exact at
 * any speed step. `rewind` is not implemented: nothing here replays a delta, and
 * the package's `Clock` makes it optional for exactly the cases that write their
 * own like this.
 */
class TunableClock implements Clock {
  constructor(private ms: number) {}
  set(ms: number): void {
    this.ms = ms;
  }
  delta(): number {
    return this.ms;
  }
}

/** Whether a value is something a canvas can draw. */
function drawable(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  const shaped = value as { width?: unknown; height?: unknown };
  return typeof shaped.width === "number" && typeof shaped.height === "number";
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  // A check reads what THIS run of the build reached for, and the transport is
  // installed once per worker, so the log is emptied as a harness is built.
  host.clear();

  const frameMs = options.frameMs ?? 1000 / TICK_HZ;
  const clock = new TunableClock(frameMs);
  const base = await kit.createHarness({
    clock,
    cssWidth: options.cssWidth,
    cssHeight: options.cssHeight,
    dpr: options.dpr,
  });
  const engine = base.engine;
  const ledger = ledgerOf(engine);

  /** The calls the last CLOSED frame's render issued. */
  let lastFrameCalls: DrawCall[] = [];
  /** Where the real pointer was last put, so a release lands where it was held. */
  let lastPointer: StagePoint = { x: 0, y: 0 };

  const view = fitViewport(
    base.shape.cssWidth,
    base.shape.cssHeight,
    base.shape.dpr,
  );

  const dispatchPointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    lastPointer = { x, y };
    const at = toCss(view, x, y);
    // Raised on the target the kit handed the engine, through the package's
    // DEVICE-bearing event, which is the one this project has always dispatched:
    // it names `pointerId`, `pointerType`, `button` and `buttons`, and an engine
    // that reads them takes a different path than it does for an event carrying a
    // position alone. Placed through ORRERY's own fit rather than the engine's,
    // so a gesture lands exactly where `Harness.css` says it does.
    base.events.dispatchEvent(
      new DevicePointerEvent(type, at.x, at.y, "mouse"),
    );
  };

  /**
   * Run one frame, counting it and the time it was worth, and keep the
   * operations its render issued as the last closed frame's.
   *
   * THE RECORDER'S LOG IS EMPTIED PER FRAME rather than let grow: a sweep of
   * several hundred frames would otherwise hold every operation of every one of
   * them, and what a check reads is one frame's worth.
   */
  const oneFrame = async (ms: number): Promise<void> => {
    base.calls.length = 0;
    await base.advance(1);
    lastFrameCalls = [...base.calls];
    ledger.frames += 1;
    ledger.timeMs += ms;
  };

  const advance = async (frames = 1): Promise<void> => {
    const count = Math.max(0, Math.floor(frames));
    for (let i = 0; i < count; i += 1) await oneFrame(clock.delta());
  };

  const readSnapshot = (): Promise<OrrerySnapshot> => base.debug.snapshot();

  const scratch = createCanvas(1, 1);

  const harness: Harness = {
    debug: base.debug,
    surfaceFault: ledger.surfaceFault,
    cues: ledger.cues,
    assetFailures: ledger.assetFailures,
    assetRequests: () => Promise.resolve([...host.urls()]),
    pageErrors: ledger.pageErrors,

    frame: () => ledger.frames,
    timeMs: () => ledger.timeMs,

    snapshot: readSnapshot,
    advance,
    async advanceSeconds(seconds, frames = 1) {
      const count = Math.max(1, Math.floor(frames));
      const ms = (seconds * 1000) / count;
      clock.set(ms);
      try {
        for (let i = 0; i < count; i += 1) await oneFrame(ms);
      } finally {
        clock.set(frameMs);
      }
    },
    async step(frames = 1) {
      await advance(frames);
      return readSnapshot();
    },
    skip: (frames = 1) => advance(frames),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);
      let snapshot = await readSnapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };
      let frames = 0;
      let sinceYield = 0;
      while (frames < maxFrames) {
        const run = Math.min(poll, maxFrames - frames);
        await advance(run);
        frames += run;
        sinceYield += run;
        snapshot = await readSnapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
        // A sweep of several hundred frames runs inside one `await`, and the
        // reporter, the timers and every socket read live on the loop it is
        // holding. Nothing observable changes; the host stops looking hung.
        sinceYield = await breathe(sinceYield);
      }
      return { hit: false, frames, snapshot };
    },

    async stepWatching(count, watch) {
      const seen: OrrerySnapshot[] = [];
      for (let i = 0; i < count; i += 1) {
        await advance(1);
        const snapshot = await readSnapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    hold: (code) => {
      base.hold(code);
      return Promise.resolve();
    },
    release: (code) => {
      base.release(code);
      return Promise.resolve();
    },
    async tap(code) {
      // Down, ONE frame, up. The frame between the two is what makes this a press
      // the game can see: the engine closes the input frame after the frame
      // renders and an edge is consumed once. Not the kit's own `tap`, which
      // presses and releases before the frame rather than across it.
      base.hold(code);
      await advance(1);
      base.release(code);
      return readSnapshot();
    },
    async holdFor(code, frames) {
      base.hold(code);
      try {
        await advance(frames);
      } finally {
        base.release(code);
      }
      return readSnapshot();
    },

    async mousePress(x, y) {
      dispatchPointer("pointerdown", x, y);
      await advance(1);
    },
    async mouseGlide(x, y) {
      dispatchPointer("pointermove", x, y);
      await advance(1);
    },
    async mouseRelease() {
      dispatchPointer("pointerup", lastPointer.x, lastPointer.y);
      await advance(1);
    },

    async frameCalls() {
      await advance(1);
      return [...lastFrameCalls];
    },
    lastCalls: () => Promise.resolve([...lastFrameCalls]),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    css: (x, y) => toCss(view, x, y),
    pixel: (x, y) => {
      const at = toDevice(view, x, y);
      const { data } = base.ctx.getImageData(at.x, at.y, 1, 1);
      return Promise.resolve([data[0], data[1], data[2], data[3]] as Pixel);
    },
    pixels: (points) =>
      Promise.resolve(
        points.map((point) => {
          const at = toDevice(view, point.x, point.y);
          const { data } = base.ctx.getImageData(at.x, at.y, 1, 1);
          return [data[0], data[1], data[2], data[3]] as Pixel;
        }),
      ),
    pixelRect: (x, y, width, height) => {
      const origin = toDevice(view, x, y);
      const wide = Math.max(1, Math.round(width * view.scale));
      const high = Math.max(1, Math.round(height * view.scale));
      const read = base.ctx.getImageData(origin.x, origin.y, wide, high);
      return Promise.resolve({
        width: read.width,
        height: read.height,
        data: new Uint8ClampedArray(read.data),
      });
    },
    imagePixels: (id) => {
      // The source's OWN pixels, at its own natural size, rather than the corner
      // of the stage it landed on — which is what settles which committed file a
      // frame drew, a path being the wrong key when a bundler may inline one.
      const source = base.images.get(id);
      if (!drawable(source)) return Promise.resolve(null);
      const shaped = source as { width: number; height: number };
      scratch.width = shaped.width;
      scratch.height = shaped.height;
      const into = scratch.getContext("2d");
      into.clearRect(0, 0, shaped.width, shaped.height);
      into.drawImage(source as unknown as Image, 0, 0);
      const read = into.getImageData(0, 0, shaped.width, shaped.height);
      return Promise.resolve({
        width: read.width,
        height: read.height,
        data: new Uint8ClampedArray(read.data),
      });
    },
    surface: () =>
      Promise.resolve({
        width: base.canvas.width,
        height: base.canvas.height,
        dpr: base.shape.dpr,
      }),

    async armAudio() {
      // A KEY rather than a pointer press, and the same one the engineless
      // project uses: `KeyO` is bound to no action in `specs/controls.md`'s whole
      // binding table, so pressing it is inert by specification. A pointer press
      // would not be: "a press anywhere else on the editor screen sets [the
      // focus] to `field`" (`specs/controls.md`), which is a state change a check
      // did not ask for.
      base.hold(INERT_KEY);
      base.release(INERT_KEY);
      await advance(1);
    },
    sounds: () => Promise.resolve(ledger.played),
    loopingSounds: () => Promise.resolve(ledger.loops.running.size),
    loopStarts: () => Promise.resolve(ledger.loops.starts),
    probe: (names) => {
      const ops: Record<string, string> = {};
      if (ledger.surfaceFault !== null) {
        for (const name of names) ops[name] = "undefined";
        return Promise.resolve({ version: undefined, ops });
      }
      const target = engine.debug as unknown as Record<string, unknown>;
      for (const name of names) ops[name] = typeof target[name];
      return Promise.resolve({ version: target.version, ops });
    },

    dispose: () => {
      base.dispose();
      // The LOG, not the transport: the shims are installed once per worker and
      // a second harness in the same worker still has to be able to load.
      host.clear();
      return Promise.resolve();
    },

    engine,
    get world() {
      return base.world;
    },
    get state() {
      return base.state;
    },
    instance: base.instance,
    canvas: base.canvas,
    ctx: base.ctx,
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */
//
// Both writers are the package's, bound here to this case's slug and to THIS
// directory — the project root may never be derived inside the package, which is
// staged one level deeper than this file, or every output would be addressed one
// directory too far down. Both carry the same name and the same shape in all
// three of Orrery's projects, and both are EVIDENCE, never a verdict: the
// scenario's own value comes straight back, a scenario that throws still leaves
// what it recorded, a capture that closed no frames writes nothing, and outside a
// run — the media directory unset — the whole thing is a no-op that still runs
// the scenario.

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the DRIVE, not the arrangement:
 *
 * ```ts
 * const measured = await captureReplay(h, "carried", () => carryOneMote(h));
 * ```
 *
 * A section longer than the format's cap is THINNED rather than cut short — every
 * nth frame kept, each kept frame's delta restated as the time since the frame
 * kept before it, and the last frame always kept — and what survives is then
 * re-expressed against tables of only what it still names. That re-tabling is the
 * package's, and it is what this project's own writer was reaching for when it
 * carried the four tables WHOLE: the property that mattered was that every
 * surviving frame stays drawable, and the package's rewrite reaches every image,
 * resource, operation and state a kept frame names, transitively, so the document
 * a player reads is the same one and the file no longer carries what only a
 * dropped frame drew with.
 */
export const captureReplay = makeReplayCapture("orrery", PROJECT_ROOT);

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why.
 *
 * ASYNCHRONOUS, which is the half of the package's pair this project binds: its
 * suites `await` it, and the package ships a synchronous `captureStill` beside it
 * for the cases whose suites do not.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return captureOutput("orrery", PROJECT_ROOT, outputId, "png", () =>
    h.canvas.toBuffer("image/png"),
  );
}
