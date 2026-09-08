// Deepcore — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// stands an engine up over a canvas it owns and a clock it scripted, and steps
// the game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT DEEPCORE'S. Standing an engine up over a
// `@napi-rs/canvas` surface, recording every operation the render issues,
// bracketing a driven frame, reading the debug surface off `engine.debug` and
// standing something in when there is none, threading a PURE surface through
// `engine.apply`, sweeping frames until a predicate holds, stamping each cue with
// the frame it sounded on, serving the produced files a bare Node process cannot
// fetch, and writing the evidence a review item declares — every engine-backed
// case needs exactly that, and it lives once, in `@clockwyrks/case-harness`,
// staged beside this file as `./case-harness/`. What is left here is what is
// genuinely Deepcore's: the shape of its snapshot, the operations
// `specs/instrumentation.md` requires, the mine's own geometry, and the scene a
// scenario poses.
//
// The seam is one call. `createEngineCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object — the engine among them, because
// the package names no engine — and hands back the machinery under Deepcore's
// names and types, so the suites next door go on importing `createHarness`,
// `captureReplay`, `openScene` and the frame arithmetic from `../harness` exactly
// as they did.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot` and `tileAt`), the engine's object model — the open world, its game
// state, its actors and its player controllers — the engine's frame counter, the
// operations the build issued against its 2D context, the pixels those operations
// left on the canvas, and the cues the engine announced. Nothing here fabricates
// an outcome: the scenario helpers below only ARRANGE the world through the debug
// surface, and the real ticks the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: `clearMine`
// leaves one kind of empty mine, `setMinerTravel(false)` holds the body and
// nothing else, a posed velocity persists across frames, and `reset` gives
// everything back. Posing through it is how a scenario is arranged, and it is
// the seam the case's specification documents. `surface.ts` is that specification
// as types, and it is the only description of the surface this harness reads: the
// build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so a
// build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. The package's `readDebugSurface` does
// that read and stands an `absentSurface` in when there is nothing to read, so
// the fault lands on the points whose checks reach the game through the surface
// rather than on the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the IDENTITY strategy, which is what a structured
// engine's state model allows. Each operation is a method that acts on the live
// world at the moment of the call — the instance holds the engine, and
// `engine.world` is the world open at that moment — so a pose is
// `h.debug.setFuel(40)` and a reading is `h.debug.tileAt(3, 9)`, with nothing in
// between and no wrapper to lose an argument in. Deepcore runs in ONE WORLD for
// the whole session and every screen is a value of `screen`, so a pose that
// changes the screen lands at the call rather than riding a level transition, and
// a check may pose and read without advancing a frame between the two.
//
// WHAT A CHECK MUST NOT READ. The build's own input. Under this engine an armed
// edge is `pressed` once PER PLAYER CONTROLLER, and the call consumes that
// controller's copy — so a check that reads `world.players()[0].input` takes the
// press the build's own controller was going to read, and the build then behaves
// as though the key was never struck. A check that wants to read an action
// directly adds a controller of its own: {@link DeepcoreModel.addObserver}.
//
// THE PRODUCED FILES REALLY LOAD. A bare Node process can neither fetch a
// page-relative URL nor decode a PNG or a `.wav`, so without help every produced
// sprite and every produced cue would fail to load and every point about one
// would fail every build ever written — a fact about Node rather than about the
// build. The package's `installAssetHost` supplies what a browser gives the
// engine's loader: a `fetch` that reads the file the build committed off the
// workspace, and a `createImageBitmap` that decodes it. The package's
// `installAudioContext` supplies the other half: the `AudioContext` the loader's
// `loadAudio` decodes a produced `.wav` through.
//
// AND THE AUDIO HALF IS NOT OPTIONAL, THOUGH THIS HEADER ONCE SAID IT WAS. What
// stood here argued that no `AudioContext` was needed because the engine
// announces every cue by name whether or not a device could sound it, so
// Deepcore's audio points are decided off the announcements and a decoder would
// have nothing to do. The first half of that is true — `cue:played`,
// `cue:looped` and `cue:stopped` carry the name, the frame and the gain, and
// nothing in this process ever sounds — and the conclusion drawn from it was
// wrong, because it is the DECODE that makes a name exist to be announced.
// `api.audio.load` binds a cue's name only once its file has decoded
// (`engine/audio.md`), and `play`, `loop` and `stop` THROW `unknown audio cue
// "<name>"` for a name nothing declared. `specs/assets.md` has a build bind all
// thirteen cues from the `.wav` files it produced, so with no `AudioContext` in
// the process every one of those loads rejects and a spec-conformant build either
// awaits them and never finishes `initialize` — failing every check in the
// project — or does not await them and throws out of its own `update` on the
// first cue it raises. Either way the verdict is a fact about Node.
//
// THE CLOCK IS THE SUITE'S. `specs/instrumentation.md` deliberately fixes no
// timestep, because every rate in this game is per second and is integrated
// against the elapsed time of the frame: a build must reach the same place
// however that time was divided. The default is a steady 120 Hz, which makes
// every duration the specification states a whole number of frames — the drill's
// 0.125 s hit is 15 of them, the hurt state's 0.4 s is 48, the notice's 1.5 s
// delay is 180 — and that is the unit the tolerances in this project were
// established in. A check that is ABOUT the step size builds harnesses with the
// engine's other clocks, which are re-exported below.
//
// AND A POSED WORLD IS RECONCILED BEFORE IT IS READ. A build is free to work a
// derived reading out at the read or to keep it as a stored copy, and a stored
// copy answers for the world as it was until `reconcile()` rewrites it. So a
// helper below that poses anything a reading derives from — a position, the
// grid, the cargo, the tiers — ends with `reconcile()`, and a check that reaches
// its scenario through the helpers never calls it itself. A check that poses
// with `h.debug.set...` directly calls it once before its first read or sweep.
// A helper that writes only state nothing derives from — a faculty gate, a held
// count — does not.
//
// AND EVERY COMPOUND SEQUENCE LIVES HERE. The surface is atomic by design: one
// field or one reading. Opening a scene, holding a faculty, laying a seam,
// standing the miner on a cell, sinking a shaft, reaching a building — none of
// those is an operation, and each of them is several. They are built once here,
// out of the atomic operations, and shared by every validator; a check that needs
// only part of a sequence calls the operations it needs.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  PlayerController,
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
  KeyEvent,
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  installAudioContext,
  wavAudioBuffer,
  type AssetHost,
  type EngineHarness,
  type EngineHarnessOptions,
  type UntilOptions,
  type UntilResult as SweptResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  pixelAt,
  sampleColor as sampleClusterColor,
} from "./case-harness/engine/2d";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  callsTo,
  setsOf,
  type DrawCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import {
  drawnText as rawDrawnText,
  drawnTextLines,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import type { Pixel } from "./case-harness/pixels";
import {
  ACTIONS,
  BACKGROUND,
  BANDS,
  CAVE_MOUTH_COL,
  CORE_COL,
  HUD_H,
  MINER_H,
  MINER_W,
  MINERALS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  STANDARD_ROWS,
  SURFACE_Y,
  TILE,
  WORLD_SIZE_SCALE,
} from "./constants";
import type { ActionName, Mineral } from "./constants";
import { game as build } from "../src/game";
import { fail } from "./assert";
import type {
  Band,
  BuildingBox,
  CellRef,
  DeepcoreDebugApi,
  DeepcoreSnapshot,
  Facing,
  ItemId,
  Material,
  MinerView,
  Mode,
  Ore,
  Screen,
  TileKind,
  TileRead,
  UpgradeTrack,
  WorldSize,
} from "./surface";

export * from "./surface";

/* The readings this project takes straight off the package, under its names. */
export type { DrawCall, Rgb, TextGeometry, UntilOptions };
export { callsTo, colorDistance, setsOf };

/** The engine's own clocks, so a check about the step size needs no import of its own. */
export {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
} from "@clockwyrks/structured-2d";
export type { Clock } from "@clockwyrks/structured-2d";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure every check that reaches for a missing surface lands on, beside
 * what `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business — the game instance's own `initialize` —
 * and a fault that misdescribed the return would send a reviewer to the wrong
 * line of the build.
 */
export const SURFACE_REQUIREMENT =
  "the debug and automation surface src/game.ts's game instance returns from " +
  "initialize, which the engine hands back from engine.debug, carrying every " +
  "operation specs/instrumentation.md requires";

/** Fail the running check on `fault`, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `n` frames of the default clock. */
export function seconds(n: number): number {
  return n / TICK_HZ;
}

/** Frames of the default clock covering `s` seconds, rounded to the nearest. */
export function ticks(s: number): number {
  return Math.max(1, Math.round(s * TICK_HZ));
}

/** A speed in units per second from a displacement measured over `n` frames. */
export function speedOverTicks(delta: number, n: number): number {
  return (Math.abs(delta) * TICK_HZ) / n;
}

/* -------------------------------------------------------------------------- */
/* Reaching the surface                                                       */
/* -------------------------------------------------------------------------- */

/** The case's surface, exactly as `surface.ts` specifies it. */
export type DeepcoreSurface = DeepcoreDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes only its own arguments and
 * returns plain data — so no wrapper stands between a check and the object the
 * build returned, and the driver type is the surface type itself. The alias is
 * kept so a check reads the same way it does in the projects next door, where the
 * surface needs driving.
 */
export type DeepcoreDriver = DeepcoreSurface;

/** The engine this project stands a build up on. */
export type DeepcoreEngine = Engine<DeepcoreSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<DeepcoreSurface>` here and the engine is parameterized with it.
 * A surface that departs from the specification is caught where a check reaches
 * for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<DeepcoreSurface>;

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One cue the build played, as the engine announced it.
 *
 * The case's own four fields rather than the package's `TimedCue`, which is a
 * superset of them: `audio/cues.ts` next door builds these by hand off the
 * engine's own events, and a shape carrying members that reading cannot fill
 * would stop it compiling for two fields no check here reads.
 */
export interface PlayedCue {
  cue: string;
  /** The frame of the drive it sounded on, as `engine.frame().count` reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
  /** `0` while the engine is muted. */
  gain: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = SweptResult<DeepcoreSnapshot>;

/** The window a harness reports to the engine, the clock it steps on, and the slot. */
export interface HarnessOptions extends EngineHarnessOptions {
  /**
   * Give the game a `localStorage` to save into. Defaults to `false`.
   *
   * Node has none, and `specs/modes.md` requires a build to run without one, so
   * the default is the storage-less host. A check about saving asks for the slot.
   */
  storage?: boolean;
}

/**
 * What this case adds to the package's neutral contract, over the engine alone.
 *
 * Every member here is a fact about DEEPCORE rather than about the machinery, and
 * several are deliberately NOT the package's member of the same name — see the
 * note against each. Bound by the kit's `extend`, which is where everything that
 * needs only the engine and the harness's own canvas belongs.
 */
export interface DeepcoreModel {
  /**
   * The world currently open, read fresh on every access.
   *
   * Deepcore opens ONE world and never another, so nothing here travels — but the
   * read is live rather than captured all the same, because what a check holds
   * must be the world the frame it just ran left behind.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access.
   *
   * Its arrangement is the BUILD's: `specs/instrumentation.md` fixes what the
   * surface reports, not what the state is called, so a check reads the game
   * through `snapshot` and comes here only for the framework's own fields.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<DeepcoreSurface>;
  /**
   * Every cue the build PLAYED, oldest first.
   *
   * The kit subscribes both firings and loop starts into one list and tells them
   * apart with `TimedCue.looped`; this case has always kept two lists, so these
   * two readings partition that one. Both are subscribed before the build's
   * `initialize` runs, so a cue raised while the game loaded is in them.
   */
  readonly cues: PlayedCue[];
  /** Every loop the build STARTED, oldest first. */
  readonly loops: PlayedCue[];

  /** One cell's state, through the case's `tileAt`. */
  tileAt(col: number, row: number): TileRead;

  /**
   * Add a player controller of the harness's own, possessing nothing and doing
   * nothing, and hand it back so a check can read the actions the frame
   * delivered.
   *
   * THE ONE WAY A CHECK READS INPUT. An armed edge is `pressed` once per player
   * controller and the call consumes that controller's copy, so reading
   * `world.players()[0].input` takes the press the BUILD's controller was going
   * to read and the build behaves as though the key was never struck. An observer
   * has a copy of every edge of its own, so reading it changes nothing the build
   * sees.
   *
   * IT IS THE ENGINE'S BARE `PlayerController`, NEVER THE BUILD'S. `addPlayer`
   * builds the mode's own `playerControllerClass` when its options name none, and
   * the build's controller is where the build reads its input and runs its screen
   * machine — so an observer built that way would be a SECOND seat driving the
   * game, moving the menu, resolving the pointer and consuming a press of its own
   * every frame. The engine's own class ticks and does nothing, which is the
   * whole of what an observer is for.
   *
   * It possesses no pawn either, so it adds nothing to the world but a seat at
   * the input.
   */
  addObserver(name?: string): PlayerController;

  /**
   * Put a key down and leave it down, as a player holding it would, remembering
   * it so {@link DeepcoreModel.releaseAll} can let it up.
   */
  hold(code: string): void;
  /** Let a key held by {@link DeepcoreModel.hold} up. */
  release(code: string): void;
  /** Let up every key this harness put down, in the order it put them down. */
  releaseAll(): void;
  /**
   * Put a key down, run the one frame that delivers it, and let it up.
   *
   * NOT THE PACKAGE'S `tap`, WHICH IS A DIFFERENT GESTURE: it presses and
   * releases and then runs a frame, so the key is up for the whole of the frame
   * that sees it. Deepcore's runs the frame BETWEEN the two, so the key is held
   * across it — which is what a build that reads a HELD action rather than an
   * edge needs, and what every one of this project's sixty-five call sites was
   * written against.
   */
  tap(code: string): Promise<void>;

  /** Put the pointer down at a logical stage point. */
  pointerDown(x: number, y: number): void;
  /** Move the pointer to a logical stage point. */
  pointerMove(x: number, y: number): void;
  /** Let the pointer up at a logical stage point. */
  pointerUp(x: number, y: number): void;
  /** Press and release at a logical stage point, then run the frame that delivers it. */
  click(x: number, y: number): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };

  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Pixel;
}

/**
 * The two members {@link createHarness} binds rather than the kit, because each
 * needs the clock THIS harness was built with and the kit's `extend` is never
 * handed the options the caller passed.
 */
export interface DeepcoreSession {
  /**
   * Run `s` seconds of game time in `frames` whole frames of `s / frames` each.
   *
   * `frames` defaults to the harness clock's own count, so `advanceSeconds(2)` is
   * `advance(240)`. A check about a LONG span names a smaller count instead: the
   * Core Sample's ninety seconds, the notice's eight-second fade, a fuel drain
   * measured over a minute. Every rate in this game is integrated against the
   * frame's delta, so a coarser division reaches the same outcome — and the
   * engine RENDERS every frame it runs, so asking for ninety frames rather than
   * ten thousand is most of what decides how long such a check takes.
   *
   * The harness's own clock is put back afterwards, so a span driven this way
   * leaves the schedule the check opened with. NOT the engineless half's
   * `advanceSeconds`, which hands one span to a build's own `advance(seconds,
   * frames)` and lets the build divide it: under an engine the division is the
   * CLOCK's, and the frames it runs are the kit's own driven frames.
   */
  advanceSeconds(s: number, frames?: number): Promise<void>;
}

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<
  DeepcoreSnapshot,
  DeepcoreDriver,
  DeepcoreEngine
> &
  DeepcoreModel &
  DeepcoreSession;

/* ---- The produced files, off disk ----------------------------------------- */

/** The directory this harness sits in, which is the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The build's own project directory: the parent of the validator project.
 *
 * The runner stages `validation/<engine>/` to `validation/` inside the build's
 * tree, so the parent of this file's directory is where `assets/` and `src/` sit,
 * and that is the directory a produced file is addressed from. Taken from this
 * module's URL rather than from the package's, which is staged one directory
 * deeper still and would name a tree one level too far down.
 */
const WORKSPACE_ROOT = dirname(PROJECT_ROOT);

/**
 * Stand the produced files up for a Node process, so a build's own loading path
 * runs unchanged.
 *
 * The engine's loader resolves every path under `assets/` and then calls the
 * host's `fetch` and `createImageBitmap` (`engine/assets.md`), and Node has
 * neither. `roots: ["."]` is the whole of what this case needs: `specs/assets.md`
 * has the build commit every produced file under the workspace at the path it
 * asks for, so the committed tree IS the tree a served page would answer from,
 * and there is no `public/` or `dist/` staging to fall back through. `onMissing`
 * is left at `"404"` — the honest answer a static server gives, and what makes
 * the engine announce `asset:failed` with a status, so a build that produced no
 * sprite fails the points about that sprite and only those.
 *
 * REFERENCE COUNTED, which is what lets a harness install one and its `dispose`
 * give it back. The shims are global, so two overlapping harnesses in one worker
 * share one installation and the globals go back only when the last hold does —
 * exactly the arithmetic this project's own `installAssets`/`removeAssets` pair
 * did before the package carried it.
 */
const ASSET_HOST = {
  workspaceRoot: WORKSPACE_ROOT,
  roots: ["."],
  images: true,
  label: "deepcore",
} as const;

/* ---- The produced cues, decoded ------------------------------------------- */

/**
 * Give the process an `AudioContext`, so a cue the build loaded from a produced
 * `.wav` actually binds its name.
 *
 * The asset loader's `loadAudio` decodes through `globalThis.AudioContext`
 * (`engine/assets.md`) and Node has none, so this is the same kind of shim
 * `installAssetHost` is and it is needed for the same reason: without it every
 * `api.audio.load` this case's thirteen cues are bound by rejects, the names stay
 * undeclared, and the build's own `play` throws out of `update` rather than any
 * point here reaching a verdict. The stand-in never sounds — every node of the
 * graph it hands back is inert — so what it supplies is the decode and nothing
 * else, which is exactly the half the engine needs to bind a name.
 *
 * `wavAudioBuffer` rather than `silentAudioBuffer`, because the honest reading is
 * the one that really decoded what the build committed: it refuses a body that is
 * not a RIFF/WAVE file carrying samples, which is a build that wired a cue name
 * to something that is not audio. Nothing in this project reads a channel off the
 * buffer — the bus announces a cue from the play call itself, never from a buffer
 * ending — so the samples reach no verdict here, and whether each named sound is
 * REAL rather than a well-formed placeholder is decided by
 * `assets/audio-files-present`, which parses the files off disk itself.
 *
 * INSTALLED ONCE FOR THE WORKER AND NEVER GIVEN BACK, unlike the asset host,
 * which each harness installs and `dispose` releases. The context carries no
 * per-harness state — it decodes bytes and answers inert nodes — so there is
 * nothing for a teardown to clear and nothing a second harness in the same worker
 * could observe from the first; the package reference-counts it either way, and a
 * worker that simply exits leaves it standing.
 */
installAudioContext({ decode: wavAudioBuffer });

/* ---- The save slot -------------------------------------------------------- */

/**
 * An in-memory `localStorage`, so the save checks have somewhere to write.
 *
 * Node has none. `specs/modes.md` requires a build to run without one, so the
 * harness's default is the storage-less host and a check about SAVING asks for
 * the slot; the check about a host that refuses storage installs nothing, or
 * installs one that throws.
 */
export function installStorage(): void {
  const held = new Map<string, string>();
  const slot: Storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
    removeItem: (key: string) => {
      held.delete(key);
    },
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    get length() {
      return held.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: slot,
    configurable: true,
    writable: true,
  });
}

/**
 * Take the storage slot away again, as a browser that blocks site data does.
 *
 * Unconditional, because it is BOTH the teardown of a harness that asked for a
 * slot and the arrangement a check about a storage-less host poses: a run without
 * storage is a requirement `specs/modes.md` states, and this is how a check
 * reaches it. Each check builds its own harness, so the two never overlap.
 */
export function removeStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/* ---- Building one --------------------------------------------------------- */

/**
 * The package's engine machinery, bound to Deepcore on this engine.
 *
 * The members that are where the engines differ are each answered here from what
 * THIS engine is:
 *
 *  - `driver` is the IDENTITY strategy: this engine's surface is already
 *    imperative, so the object the build returned is what a check calls, and
 *    naming the strategy is what says so in the type system.
 *  - `toLogical` is left at the identity. The camera is applied by the PIPELINE,
 *    inside the frame the engine's fit already covers, so nothing stands between
 *    a logical stage point and that fit; a WORLD point goes through
 *    {@link worldToStage} first.
 *  - `pointerPrecision` is left at `"exact"`, so a raised pointer lands exactly
 *    where the caller asked rather than on the nearest device pixel — which is
 *    what this project's own pointer helpers, which passed a stage point straight
 *    through as a client position, have always done.
 *  - `pointerEvent` is left at the package's default, the POSITION-ONLY event.
 *    `specs/controls.md` names no device and the engine's pointer input reads
 *    `clientX`, `clientY` and `isPrimary` off it, which is the event this
 *    project's own `PointerEvt` carried, field for field.
 *  - `cueEvents` names both firings and loop starts, because this case keeps two
 *    lists and both must be subscribed before the game's `initialize` runs; the
 *    two readings on {@link DeepcoreModel} partition the one list the kit fills.
 */
const kit = createEngineCaseHarness<
  DeepcoreSnapshot,
  DeepcoreDriver,
  DeepcoreEngine,
  DeepcoreModel
>({
  slug: "deepcore",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // The text readings below place a run about its anchor, and the package's
  // `drewText` (which every copy check imports) reads copy off the logical
  // runs the shared harness merges side-by-side glyphs into — nothing merges
  // without each draw's extent — so each text call is measured and the
  // transform in force at it recorded.
  recorder: { measureText: true },
  cueEvents: ["cue:played", "cue:looped"],
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<DeepcoreSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it. NO touch layout is selected, because
      // `src/main.ts` selects none: Deepcore is played with the keyboard and the
      // mouse alone, and its actions are its own rather than a layout's.
      background: BACKGROUND,
      clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (_engine, raw) => identityDriver(raw as DeepcoreSurface),
  snapshot: (debug) => debug.snapshot(),
  extend: (base, engine, initialized) => {
    // Captured BEFORE the kit defines this object's members over `base`, because
    // the two readings below are defined AS `cues` and reading `base.cues` after
    // that would reach the accessor rather than the list behind it.
    const stamped = base.cues;
    /** The keys this harness put down and has not let up. */
    const held: string[] = [];
    const key = (type: "keydown" | "keyup", code: string): void => {
      base.events.dispatchEvent(new KeyEvent(type, code));
    };
    const model: DeepcoreModel = {
      get world() {
        return engine.world;
      },
      get state() {
        return engine.world.state;
      },
      instance: initialized as GameInstance<DeepcoreSurface>,
      get cues() {
        return stamped.filter((cue) => !cue.looped);
      },
      get loops() {
        return stamped.filter((cue) => cue.looped);
      },

      tileAt: (col, row) => base.debug.tileAt(col, row),

      addObserver: (name = "observer") =>
        engine.world.mode.addPlayer({
          name,
          controller: PlayerController,
          pawn: null,
        }),

      hold(code) {
        if (!held.includes(code)) held.push(code);
        key("keydown", code);
      },
      release(code) {
        const at = held.indexOf(code);
        if (at >= 0) held.splice(at, 1);
        key("keyup", code);
      },
      releaseAll() {
        for (const code of [...held]) model.release(code);
      },
      async tap(code) {
        key("keydown", code);
        await base.advance(1);
        key("keyup", code);
      },

      pointerDown: (x, y) => base.pointer("pointerdown", x, y),
      pointerMove: (x, y) => base.pointer("pointermove", x, y),
      pointerUp: (x, y) => base.pointer("pointerup", x, y),
      async click(x, y) {
        base.pointer("pointermove", x, y);
        base.pointer("pointerdown", x, y);
        base.pointer("pointerup", x, y);
        await base.advance(1);
      },

      async frameCalls() {
        base.calls.length = 0;
        await base.advance(1);
        return [...base.calls];
      },

      probe(names) {
        const ops: Record<string, string> = {};
        const object = base.debug as unknown as Record<string, unknown>;
        for (const name of names) ops[name] = typeof object[name];
        return { version: object.version, ops };
      },

      devicePixel: (x, y) => pixelAt(base.ctx, { x, y }),
    };
    return model;
  },
});

/**
 * Stand an engine up over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * THREE THINGS ARE BOUND HERE RATHER THAN ON THE KIT, and each is a fact about
 * this project's own options rather than about the engine:
 *
 *   - the asset host, installed before the engine is built so the build's
 *     `initialize` can load what it produced, and given back by `dispose`;
 *   - the save slot, which `HarnessOptions.storage` asks for and nothing else in
 *     the package knows about;
 *   - `advanceSeconds`, which needs the clock THIS harness was built with — the
 *     one the caller passed, or the case's own 120 Hz — to put back after it has
 *     moved it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const clock: Clock = options.clock ?? new ConstantClock(TICK_MS);
  const host: AssetHost = installAssetHost(ASSET_HOST);
  if (options.storage === true) installStorage();

  const h = await kit.createHarness({ ...options, clock });
  const destroy = h.dispose;

  return Object.assign(h, {
    async advanceSeconds(s: number, frames = ticks(s)): Promise<void> {
      if (!Number.isInteger(frames) || frames < 1) {
        throw new RangeError(
          `advanceSeconds needs a whole number of frames of at least 1, got ${frames}`,
        );
      }
      h.engine.setClock(new ConstantClock((s * 1000) / frames));
      try {
        await h.advance(frames);
      } finally {
        h.engine.setClock(clock);
      }
    },

    dispose(): void {
      h.releaseAll();
      destroy();
      host.uninstall();
      if (options.storage === true) removeStorage();
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Both are evidence, never a verdict: the scenario's own value comes straight
// back, a scenario that throws still leaves what it recorded, a capture that
// closed no frames writes nothing, and outside a run the media directory is unset
// and the whole thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const cut = await captureReplay(h, "cut", () => driveCut(h, "down", target));
 * assertEqual(cut.broke, true);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export const captureReplay = makeReplayCapture("deepcore", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * the status bar reads, how the mine was drawn at depth. A recording of a still
 * screen would be the same frame three hundred times over, and a reviewer looking
 * at a menu wants to look at the menu.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* World geometry                                                             */
/* -------------------------------------------------------------------------- */
//
// The mine has a coordinate space of its own, in the same logical units as the
// stage, and the viewport is a window onto it. Nothing here reads the build: each
// is the arithmetic `specs/world.md` states, so a check that samples a pixel over
// a tile is sampling where the specification says that tile is drawn.

/** The four bands, shallowest first. */
export const BAND_ORDER: readonly Band[] = BANDS;

/** The Core chamber's row: `round(STANDARD_ROWS * WORLD_SIZE_SCALE)`. */
export function coreRowFor(size: WorldSize): number {
  return Math.round(STANDARD_ROWS * WORLD_SIZE_SCALE[size]);
}

/** `depthFraction(row) = (row - 1) / (coreRow - 1)`: `0` at row 1, `1` at the deepest. */
export function depthFraction(row: number, coreRow: number): number {
  return (row - 1) / (coreRow - 1);
}

/** The row whose depth fraction is `f`, at a mine of `coreRow` rows. */
export function rowAtFraction(f: number, coreRow: number): number {
  return Math.round(1 + f * (coreRow - 1));
}

/** The band index a depth fraction falls in: the mine quarters into four bands. */
export function bandIndexAt(f: number): number {
  return Math.min(3, Math.floor(4 * f));
}

/** The band a depth fraction falls in. */
export function bandAtFraction(f: number): Band {
  return BAND_ORDER[bandIndexAt(f)];
}

/** The band a row falls in, at the mine the snapshot describes. */
export function bandOfRow(snapshot: DeepcoreSnapshot, row: number): Band {
  return bandAtFraction(depthFraction(row, snapshot.coreRow));
}

/** A row well inside `band`, at a mine of `coreRow` rows: the band's midpoint. */
export function rowInBand(band: Band, coreRow: number): number {
  return rowAtFraction((BAND_ORDER.indexOf(band) + 0.5) / 4, coreRow);
}

/** One ore's or gemstone's entry in the mineral table, by id. */
export function mineralOf(ore: Ore): Mineral {
  const entry = MINERALS.find((mineral) => mineral.id === ore);
  if (entry === undefined) {
    fail(`one of the thirteen mineral ids specs/mining.md fixes`, ore);
  }
  return entry;
}

/** The world-space rectangle a cell occupies. */
export function cellRect(
  col: number,
  row: number,
): { x: number; y: number; w: number; h: number } {
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
}

/** The world-space centre of a cell. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

/** The cell a world point falls in. */
export function cellAt(x: number, y: number): CellRef {
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

/** The world-space centre of the miner's box. */
export function minerCenter(miner: MinerView): { x: number; y: number } {
  return { x: miner.x + MINER_W / 2, y: miner.y + MINER_H / 2 };
}

/** The world `y` of the bottom of the miner's box: its feet. */
export function minerFeet(miner: MinerView): number {
  return miner.y + MINER_H;
}

/** The box `x` that centres the miner on `col`. */
export function minerXOn(col: number): number {
  return col * TILE + (TILE - MINER_W) / 2;
}

/** The box `y` of a miner standing on top of `row`. */
export function minerYOn(row: number): number {
  return row * TILE - MINER_H;
}

/** The box `y` of a miner standing on the camp ground. */
export const CAMP_MINER_Y = SURFACE_Y - MINER_H;

/**
 * Where a world point is drawn on the stage: `(wx - camX, wy - camY + HUD_H)`.
 *
 * The camera is read off the snapshot the caller already has, so the mapping is
 * the one in force at the frame that was sampled.
 */
export function worldToStage(
  snapshot: DeepcoreSnapshot,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: wx - snapshot.camera.x, y: wy - snapshot.camera.y + HUD_H };
}

/** Whether a stage point falls inside the mine viewport rather than the status bar. */
export function inViewport(x: number, y: number): boolean {
  return x >= 0 && x <= STAGE_W && y >= HUD_H && y <= STAGE_H;
}

/** The load fraction the snapshot reports: `loadKg / liftLimitKg`. */
export function loadFraction(snapshot: DeepcoreSnapshot): number {
  return snapshot.cargo.loadKg / snapshot.cargo.liftLimitKg;
}

/** The Core tile's cell at a size, without asking the build where it is. */
export function coreCell(size: WorldSize): CellRef {
  return { col: CORE_COL, row: coreRowFor(size) };
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * The engine owns the audio bus, so a cue is announced BY NAME
 * (`engine/audio.md`): what a check reads is which of the thirteen names
 * `specs/assets.md` fixes the build asked for, and on which frame — so a build
 * that plays its launch cue on every drill hit is caught rather than merely
 * heard. A muted play still reports, with `gain` at `0`.
 */
export function watchCues(h: Harness): PlayedCue[] {
  const played: PlayedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, frame: h.frame(), t, gain });
  });
  return played;
}

/** Record every loop the build starts from now on, the same way. */
export function watchLoops(h: Harness): PlayedCue[] {
  const started: PlayedCue[] = [];
  h.engine.events.on("cue:looped", ({ cue, t, gain }) => {
    started.push({ cue, frame: h.frame(), t, gain });
  });
  return started;
}

/** Whether `cue` sounded at any point in `played`. */
export function sounded(played: readonly PlayedCue[], cue: string): boolean {
  return played.some((entry) => entry.cue === cue);
}

/* -------------------------------------------------------------------------- */
/* Isolation: opening a scene                                                 */
/* -------------------------------------------------------------------------- */
//
// A validator poses an isolated world: it clears every entity its requirement is
// not about and puts back exactly what it is. In Deepcore that means an empty
// mine — no ore to bank by accident, no gas to detonate under the miner, no lava
// to drain hull while a fuel check runs — and a miner carrying only the faculties
// the requirement exercises. `reset` already leaves the mine empty, the cargo
// empty, the satchel empty and no supplies held, so a scene is that plus the
// screen, the size, and the faculties.

/** How a scene opens. Everything is optional; the defaults are the resting world. */
export interface SceneOptions {
  /**
   * The world size.
   *
   * `setWorldSize` RESIZES the mine onto the new depth rather than emptying it
   * (`specs/instrumentation.md`, "Resizing the mine"): shared cells come through
   * untouched, rows past the new Core chamber go with their rows, and rows the
   * old depth did not reach open as an empty mine holds them. A `reset` has just
   * left the grid empty, so the explicit `clearMine` below is what guarantees the
   * scene opens on an empty mine at the size that was named, whichever direction
   * the resize went.
   */
  size?: WorldSize;
  /** The expedition's mode. Defaults to `standard`, as a `reset` leaves it. */
  mode?: Mode;
  /** The screen to open on. Defaults to `in-mine`. */
  screen?: Screen;
  /** Whether the miner's body moves. Defaults to on, as a `reset` leaves it. */
  travel?: boolean;
  /** Whether the miner's drill cuts. Defaults to on, as a `reset` leaves it. */
  drill?: boolean;
}

/**
 * The opening every posed check shares: the world back at its resting value, and
 * the screen the check is about.
 *
 * What it leaves is an EMPTY mine — `reset` restores the grid to what `clearMine`
 * leaves — with the miner standing at the camp, tier 1 everywhere, a full tank and
 * hull, no Credits, nothing held, and no notice fired. A check then places exactly
 * what its requirement is about.
 *
 * The engine's mute bit and the save slot are deliberately outside this, because
 * `reset` leaves both alone: a fresh harness is what clears them, and every check
 * builds one.
 */
export function openScene(h: Harness, options: SceneOptions = {}): void {
  h.debug.reset();
  if (options.size !== undefined) {
    h.debug.setWorldSize(options.size);
    h.debug.clearMine();
  }
  if (options.mode !== undefined) h.debug.setMode(options.mode);
  h.debug.setScreen(options.screen ?? "in-mine");
  if (options.travel !== undefined) h.debug.setMinerTravel(options.travel);
  if (options.drill !== undefined) h.debug.setMinerDrill(options.drill);
  h.debug.reconcile();
}

/**
 * Hold the miner's body still for what follows: gravity, walking, thrust,
 * knockback and collision displacement all move it nowhere.
 *
 * The faculty gate `specs/instrumentation.md` fixes, named for what it is FOR. A
 * check about the drill, about fuel burn, about a hazard's damage or about the
 * cargo does not want the miner falling out of the scenario it was posed in, and
 * everything else about the miner carries on: it still reads as grounded, still
 * starts and holds a cut, still spends fuel, still takes damage, and the camera
 * still follows it.
 */
export function pinMiner(h: Harness): void {
  h.debug.setMinerTravel(false);
}

/**
 * Hold the miner's drill for what follows: no cut starts, none progresses, no
 * cell loses health, nothing is banked, and no drill hit spends fuel.
 *
 * The companion gate. A check about movement, about the camera, about fall impact
 * or about fuel's other drains holds this, so a key held to steer the miner
 * cannot quietly bore a hole through the scenario.
 */
export function pinDrill(h: Harness): void {
  h.debug.setMinerDrill(false);
}

/* -------------------------------------------------------------------------- */
/* Isolation: laying the terrain a check is about                             */
/* -------------------------------------------------------------------------- */

/** Fill a run of cells down one column with one kind. */
export function fillColumn(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  kind: TileKind,
): void {
  for (let row = fromRow; row <= toRow; row += 1) {
    h.debug.setTile(col, row, kind);
  }
  h.debug.reconcile();
}

/** Fill a run of cells across one row with one kind. */
export function fillRow(
  h: Harness,
  row: number,
  fromCol: number,
  toCol: number,
  kind: TileKind,
): void {
  for (let col = fromCol; col <= toCol; col += 1) {
    h.debug.setTile(col, row, kind);
  }
  h.debug.reconcile();
}

/** Fill a rectangular block of cells with one kind. */
export function fillBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
  kind: TileKind,
): void {
  for (let row = block.fromRow; row <= block.toRow; row += 1) {
    fillRow(h, row, block.fromCol, block.toCol, kind);
  }
  h.debug.reconcile();
}

/**
 * A floor across the whole playable width at `row`, so a miner anywhere above it
 * lands rather than falling out of the scenario.
 *
 * `rock` by default, because rock is the kind that yields nothing: a floor of ore
 * would bank a unit the moment a check drilled it, and a floor of gas would end
 * the check in a detonation.
 */
export function layFloor(
  h: Harness,
  row: number,
  kind: TileKind = "rock",
): void {
  fillRow(h, row, PLAYABLE_COL_MIN, PLAYABLE_COL_MAX, kind);
}

/**
 * Lay the camp's ground: `row 1` solid across the playable width, with the cave
 * mouth left open, exactly as generation leaves it.
 *
 * An empty mine is open everywhere, `row 0` included, so a miner posed at the
 * camp falls the moment the first frame runs. Generation leaves `row 1` minable
 * apart from `(CAVE_MOUTH_COL, 1)`, and that is what holds the miner up while it
 * walks the camp — so a scene about the surface, the buildings, or a panel lays
 * it back rather than posing the miner in mid-air and pinning it.
 */
export function layCamp(h: Harness, kind: TileKind = "rock"): void {
  layFloor(h, 1, kind);
  h.debug.setTile(CAVE_MOUTH_COL, 1, "tunnel");
  h.debug.reconcile();
}

/**
 * Open every cell of a block, so a scenario has room to move through it.
 *
 * A cleared mine is already open everywhere, so this is for a scene that laid
 * terrain and now wants a pocket back — the run-up in front of a wall, the space
 * under a miner that must fall.
 */
export function openBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
): void {
  fillBlock(h, block, "tunnel");
}

/**
 * Stand the miner on top of the cell `(col, row)`, centred on its column, at rest.
 *
 * THAT CELL IS THE FLOOR UNDERFOOT, and so the cell a held down cut bites into —
 * not the one below it. A check that wants a gas pocket under the drill poses it
 * at `(col, row)` and stands the miner here with the same `row`.
 *
 * The cell the miner's BOX occupies is the one above, so a scene lays its floor
 * at `row` and leaves `row - 1` open.
 */
export function standOn(
  h: Harness,
  col: number,
  row: number,
  facing?: Facing,
): void {
  h.debug.setMinerPosition(minerXOn(col), minerYOn(row));
  h.debug.setMinerVelocity(0, 0);
  if (facing !== undefined) h.debug.setFacing(facing);
  h.debug.reconcile();
}

/** Put the miner's box at a world position, at rest. */
export function placeAt(h: Harness, x: number, y: number): void {
  h.debug.setMinerPosition(x, y);
  h.debug.setMinerVelocity(0, 0);
  h.debug.reconcile();
}

/** Stand the miner on the camp ground at `col`, where it spawns by default. */
export function standAtCamp(
  h: Harness,
  col: number = SPAWN_COL,
  facing?: Facing,
): void {
  standOn(h, col, 1, facing);
}

/**
 * A one-tile shaft down `col`, open from `fromRow` to `toRow`, standing on the
 * solid cell beneath it, with solid walls either side.
 *
 * The scene a climb, a fall, or a sink is measured in: the walls are what stop a
 * miner drifting laterally out of the column, and the floor is what a fall lands
 * on and a down cut bites into.
 */
export function digShaft(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  wall: TileKind = "rock",
): void {
  fillColumn(h, col, fromRow, toRow, "tunnel");
  fillColumn(h, col - 1, fromRow, toRow, wall);
  fillColumn(h, col + 1, fromRow, toRow, wall);
  h.debug.setTile(col, toRow + 1, wall);
  h.debug.reconcile();
}

/** Put an ore vein at a cell, at its band's full health. */
export function layOre(h: Harness, col: number, row: number, ore: Ore): void {
  h.debug.setOreTile(col, row, ore);
  h.debug.reconcile();
}

/** Put a material node at a cell, at its band's full health. */
export function layMaterial(
  h: Harness,
  col: number,
  row: number,
  material: Material,
): void {
  h.debug.setMaterialTile(col, row, material);
  h.debug.reconcile();
}

/* -------------------------------------------------------------------------- */
/* Isolation: posing the expedition's holdings                                */
/* -------------------------------------------------------------------------- */

/**
 * Pose the cargo bay as exactly the ore listed, and nothing else.
 *
 * `setCargo` sets one ore's count and leaves the rest, so a scene that wants a
 * known load clears the bay first — otherwise it is posing a load on top of
 * whatever the check before it banked.
 */
export function stageCargo(
  h: Harness,
  ore: Partial<Record<Ore, number>>,
): void {
  h.debug.clearCargo();
  for (const [id, count] of Object.entries(ore)) {
    h.debug.setCargo(id as Ore, count as number);
  }
  h.debug.reconcile();
}

/**
 * Load the bay with `ore` until the load fraction is at least `fraction`, and
 * report the fraction reached.
 *
 * One unit of one ore at a time, because the load is whole units of whole ores: a
 * fraction is reached by the unit that crosses it rather than exactly, which is
 * the point of the overload wall — the flag flips on the unit that crosses the
 * limit. The count is derived from the lift limit the snapshot reports, so it
 * follows the jetpack tier the scene posed rather than assuming tier 1.
 */
export function loadToFraction(
  h: Harness,
  fraction: number,
  ore: Ore = "ferron",
): { count: number; fraction: number } {
  h.debug.clearCargo();
  const { cargo } = h.snapshot();
  const count = Math.ceil(
    (fraction * cargo.liftLimitKg) / mineralOf(ore).weightKg,
  );
  h.debug.setCargo(ore, count);
  h.debug.reconcile();
  return { count, fraction: loadFraction(h.snapshot()) };
}

/** Pose the six field-supply counts as exactly what is listed, and nothing else. */
export function stageItems(
  h: Harness,
  items: Partial<Record<ItemId, number>>,
): void {
  h.debug.clearItems();
  for (const [id, count] of Object.entries(items)) {
    h.debug.setItemCount(id as ItemId, count as number);
  }
}

/** Pose upgrade tracks at named tiers, so a check reads one configuration. */
export function stageTiers(
  h: Harness,
  tiers: Partial<Record<UpgradeTrack, number>>,
): void {
  for (const [track, tier] of Object.entries(tiers)) {
    h.debug.setTier(track as UpgradeTrack, tier as number);
  }
  h.debug.reconcile();
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. The geometry and the tolerances they encode are the ones
// the specification established, and they are the same in the projects next door.

/**
 * One key per action, for the sequences that press one.
 *
 * The FIRST code `specs/controls.md` binds to each action, because an action
 * bound to several is satisfied by any of them and a scenario needs one. A check
 * about the bindings presses each of them itself.
 */
export const ACTION_KEY = Object.fromEntries(
  Object.entries(ACTIONS).map(([action, codes]) => [action, codes[0]]),
) as Record<ActionName, string>;

/** A code no action in `ACTIONS` is bound to, so pressing it changes nothing. */
export const UNBOUND_KEY = "KeyZ";

/**
 * Open an expedition through the SURFACE alone: the mode, the size, a freshly
 * generated mine, and the miner standing at the spawn.
 *
 * This is how a check about the MINE reaches its ground without driving the menus
 * — a build with a broken menu and a working world must fail the navigation
 * checks and pass the generation ones. A check about the menus enters with
 * {@link startWithKeys} instead.
 */
export function openExpedition(
  h: Harness,
  options: { size?: WorldSize; mode?: Mode } = {},
): void {
  h.debug.reset();
  if (options.mode !== undefined) h.debug.setMode(options.mode);
  if (options.size !== undefined) h.debug.setWorldSize(options.size);
  h.debug.generateMine();
  h.debug.setScreen("in-mine");
  standAtCamp(h);
}

/**
 * Start an expedition from the title the way a player does: menu keys only.
 *
 * The title menu leads with `CONTINUE` only while a save exists, so this clears
 * the slot first — otherwise the index every step below counts from moves under
 * it, and a check about the menus would be reading a menu it did not mean to
 * open. `NEW EXPEDITION` then leads, the mode is one step down for Hardcore, and
 * the size is however many steps down its entry sits.
 */
export async function startWithKeys(
  h: Harness,
  options: { mode?: Mode; size?: WorldSize } = {},
): Promise<void> {
  const mode = options.mode ?? "standard";
  const size = options.size ?? "standard";
  h.debug.clearSave();
  h.debug.reset();
  h.debug.setScreen("title");

  const down = ACTION_KEY.down;
  const confirm = ACTION_KEY.activate;

  // title -> mode-select, on `NEW EXPEDITION`, which leads with no save banked.
  await h.tap(confirm);
  // mode-select: STANDARD leads, HARDCORE is one down.
  if (mode === "hardcore") await h.tap(down);
  await h.tap(confirm);
  // size-select: QUICK, STANDARD, MARATHON, in that order.
  const steps = { quick: 0, standard: 1, marathon: 2 }[size];
  for (let i = 0; i < steps; i += 1) await h.tap(down);
  await h.tap(confirm);
}

/**
 * Stand the miner at the building `id`, on the camp ground, and report its
 * footprint.
 *
 * The footprints are the BUILD'S — `specs/world.md` fixes only that each sits on
 * the ground line inside the playable columns, spaced apart — so a check that
 * activates one asks the surface where it is rather than assuming a layout. The
 * miner is centred on the footprint, which is the one spot inside it whatever
 * reach the build gives its buildings.
 */
export function standAtBuilding(h: Harness, id: string): BuildingBox {
  const boxes = h.debug.buildings();
  const box = boxes.find((b) => b.id === id);
  if (box === undefined) {
    fail(
      `a surface building with id "${id}" among the six specs/world.md fixes`,
      `buildings() reported ${boxes.length === 0 ? "none" : boxes.map((b) => b.id).join(", ")}`,
    );
  }
  placeAt(h, box.x + box.w / 2 - MINER_W / 2, CAMP_MINER_Y);
  return box;
}

/** What a driven cut did. */
export interface CutResult {
  /** Whether the target cell broke inside the sweep. */
  broke: boolean;
  /** Frames driven before the sample that saw it break. */
  frames: number;
  /** The cell as it stands at the end of the sweep. */
  tile: TileRead;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a direction until the cell it cuts breaks, and report the instant it did.
 *
 * The real drill: the key goes down through the engine's own input, the game's
 * update lands the hits at its own interval and spends its own fuel, and the
 * sweep watches the cell rather than the clock. Sampled every frame, because the
 * frame the cell breaks on is what several checks read.
 *
 * The key is released before this returns, so a caller reads a settled miner
 * rather than one still boring into whatever was behind the cell.
 */
export async function driveCut(
  h: Harness,
  direction: "down" | "left" | "right",
  target: CellRef,
  options: UntilOptions = {},
): Promise<CutResult> {
  const code = ACTION_KEY[direction];
  h.hold(code);
  try {
    // The sweep is over the CELL rather than the snapshot, which is what `until`
    // reads, so the loop is written out here rather than borrowed.
    const maxFrames = options.maxFrames ?? 600;
    const poll = Math.max(1, options.poll ?? 1);
    let frames = 0;
    let tile = h.tileAt(target.col, target.row);
    while (frames < maxFrames && tile.kind !== "tunnel") {
      const step = Math.min(poll, maxFrames - frames);
      await h.advance(step);
      frames += step;
      tile = h.tileAt(target.col, target.row);
    }
    return {
      broke: tile.kind === "tunnel",
      frames,
      tile,
      snapshot: h.snapshot(),
    };
  } finally {
    h.release(code);
  }
}

/** What a held movement did. */
export interface MoveResult {
  /** The miner's box position before the measured window. */
  start: { x: number; y: number };
  /** And after it. */
  end: { x: number; y: number };
  dx: number;
  dy: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a key for `frames` frames and report how far the miner's box travelled.
 *
 * Nothing here poses a velocity: the key goes down and the game's own movement
 * code moves the miner, so what is measured is the build's walk, thrust or fall
 * rather than an integration the harness did.
 */
export async function driveHold(
  h: Harness,
  code: string,
  frames: number,
  options: { leadFrames?: number } = {},
): Promise<MoveResult> {
  h.hold(code);
  try {
    // With a lead, the key is already down for `leadFrames` before the measured
    // window opens, so the window reads a miner in steady travel rather than the
    // frame the press was first seen on.
    if (options.leadFrames) await h.advance(options.leadFrames);
    const before = h.snapshot().miner;
    await h.advance(frames);
    const after = h.snapshot();
    return {
      start: { x: before.x, y: before.y },
      end: { x: after.miner.x, y: after.miner.y },
      dx: after.miner.x - before.x,
      dy: after.miner.y - before.y,
      snapshot: after,
    };
  } finally {
    h.release(code);
  }
}

/** What a driven fall did. */
export interface FallResult {
  landed: boolean;
  /** The fastest downward speed the sweep saw. */
  impactSpeed: number;
  hullBefore: number;
  hullAfter: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Drop the miner from `height` world units above the floor at `(col, floorRow)`
 * and run the real physics until it lands, reporting the speed it landed at and
 * the hull it cost.
 *
 * The fall is the game's own: gravity, the terminal speed the load sets, and the
 * impact rule all run from a miner posed at rest in open air.
 */
export async function driveFall(
  h: Harness,
  col: number,
  floorRow: number,
  height: number,
  options: UntilOptions = {},
): Promise<FallResult> {
  placeAt(h, minerXOn(col), minerYOn(floorRow) - height);
  const before = h.snapshot().miner;
  let fastest = 0;
  const swept = await h.until(
    (s) => {
      if (s.miner.vy > fastest) fastest = s.miner.vy;
      return s.miner.grounded;
    },
    { maxFrames: options.maxFrames ?? 900, poll: options.poll ?? 1 },
  );
  // One frame past the first that reads as grounded. A build is free to report a
  // miner about to touch down as grounded — the flag says it is resting on solid
  // ground, and a probe a unit or two ahead of the box is a conformant way to
  // answer that — so the frame the flag first turns on is not necessarily the
  // frame the contact was resolved and the hull was billed on. The extra frame
  // costs a settled miner nothing and is what makes the reading the LANDING
  // rather than the approach to it. The speed is the fastest the sweep saw, which
  // is the speed it arrived at whichever frame resolved it.
  if (swept.hit) await h.advance(1);
  const settled = h.snapshot();
  return {
    landed: swept.hit,
    impactSpeed: fastest,
    hullBefore: before.hull,
    hullAfter: settled.miner.hull,
    snapshot: settled,
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering and colour                                                       */
/* -------------------------------------------------------------------------- */
//
// The readings a check makes over what a frame left behind. Most are the
// package's, taken under this project's own names; three are NOT (`DRAW_METHODS`,
// `drawnPoints` and `imageDraws`), and each of the three is a place where the
// package ships a reading of the same name that answers a different question.
// Folding one into the other would silently move a threshold rather than fail,
// so this file binds the reading Deepcore's verdicts were established under and
// says which it is. `drewText` is not bound here at all: a suite imports the
// package's from `case-harness/text`, and reads copy off the frame's logical runs.

/** The radius the five-point colour cluster is spread over, in logical units. */
const SAMPLE_RADIUS = 6;

/**
 * The rendered colour at a logical stage point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 6 units out, which at an 80-unit tile
 * stays well inside the cell whatever the build drew there, so one stray
 * anti-aliased or glowing pixel cannot swing the reading. The package's cluster
 * defaults to 4 units, which is a different patch of a smaller tile; this case
 * passes its own.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleClusterColor(h, x, y, SAMPLE_RADIUS);
}

/**
 * The rendered colour over the centre of a WORLD cell, through the camera the
 * snapshot reports.
 *
 * The reading a terrain check takes: pose one cell, drive a frame, and sample
 * where the specification says that cell is drawn.
 */
export function sampleCell(
  h: Harness,
  snapshot: DeepcoreSnapshot,
  col: number,
  row: number,
): Rgb {
  const centre = cellCenter(col, row);
  const at = worldToStage(snapshot, centre.x, centre.y);
  return sampleColor(h, at.x, at.y);
}

/* ---- Reading one frame's render ------------------------------------------- */

/**
 * Every logical run of text the frame spelled, as the strings it spells: a
 * letter-spaced heading drawn one glyph per call is ONE entry. The shared
 * harness's reading, re-exported so a suite reads copy the way the package's
 * `drewText` does; {@link drawnText} below stays the raw split, one string per
 * call.
 */
export { drawnTextLines };

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return rawDrawnText(calls);
}

/** One run of text a frame drew, placed in logical units. */
export type TextSpan = TextDraw;

/**
 * Every run of text in `calls`, placed in logical units, ONE PER CALL.
 *
 * A build is free to draw under any transform it likes — the pipeline sets the
 * camera's world-to-device transform before a component draws, and a component
 * drawing the status bar takes the camera back out again — so the position a
 * `fillText` names is only where the text landed once the transform in force at
 * that call is applied. The package's
 * `textDraws` places each draw through the transform the recorder took at it,
 * and extends the run about its anchor by its measured width and `textAlign`;
 * what this adds is the conversion out of canvas pixels and into the logical
 * units every figure this project states is stated in. At the harness's default
 * shape the two coincide; at any other they do not, and a check that runs at
 * another shape reads what it meant either way.
 *
 * ONE PER CALL, deliberately: the package also ships `drawnTextRuns`, which
 * coalesces neighbouring draws into the logical run they spell, and a merged run
 * is wider than any of its members. `hud/bar.ts` measures a readout's own extent
 * and clears a region with it, which is the per-call question.
 */
export function textSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(calls));
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * scanner indicator asked for strictly more of these than the same frame with
 * nothing locked, whatever shape the build chose to draw it as.
 *
 * THE CASE'S OWN LIST, which is the package's less `putImageData`. A count is
 * only ever compared against another count taken the same way, so a list that
 * admitted one more method would move both sides of every comparison this
 * project makes by however many times the build blits a buffer — and nothing
 * would fail to say so.
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
 * Every point a frame's drawing calls named, IN THE COORDINATES THEY WERE ISSUED
 * IN.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the last
 * pair. The pipeline sets the camera's transform before a component draws, so
 * these are world units for anything drawn through the camera and stage units for
 * a component that took the camera back out; a check that needs one or the other
 * says which by where it looks.
 *
 * NOT THE PACKAGE'S `drawnPoints`, WHICH MAPS EVERY POINT THROUGH THE TRANSFORM
 * IN FORCE and so answers in canvas pixels. That is the right reading for a case
 * that asks where a thing LANDED; this one asks what the build ASKED FOR, which
 * is how a cell drawn at its world coordinate is told from one drawn at the
 * screen position the camera happened to put it at. The two agree only while the
 * transform is the identity, which inside this game's mine it never is.
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

/**
 * Every image a frame blitted, as `[source, ...arguments]`.
 *
 * A produced sprite reaches the canvas through `drawImage`, and which SOURCE
 * RECTANGLE the call named is how a sprite-sheet cycle is read: the frame index a
 * build is on is `sx / frameWidth`. A build that drew a code fallback instead
 * issued no `drawImage` at all, which is the reading that tells the two apart.
 *
 * NOT THE PACKAGE'S `imageDraws`, WHICH ANSWERS `ImageDraw[]` — a placed
 * destination rectangle and an `ImageRef` naming the bitmap — and reads nothing
 * at all unless the recorder is interning images, which this project does not ask
 * it to. This one is the raw argument lists, which is what the readings over it
 * next door walk.
 */
export function imageDraws(calls: readonly DrawCall[]): unknown[][] {
  return callsTo(calls, "drawImage");
}
