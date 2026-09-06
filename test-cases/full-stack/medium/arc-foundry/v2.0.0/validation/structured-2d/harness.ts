// Arc Foundry — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing serves a site, nothing
// polls, and no wall-clock time passes: a check asks for a number of frames and
// gets exactly that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT ARC FOUNDRY'S. The canvas and its
// draw-command recorder, the debug surface and the stand-in for a missing one, the
// driver a check calls that surface through, the frame sweep, the
// cue stamping, the transport that serves the produced tree to the engine's asset
// loader, and the evidence a review item's output is written from — every engine
// case needs exactly that, and it lives once, in `@clockwyrks/case-harness`, staged
// beside this file as `./case-harness/`. What stays HERE is what is genuinely Arc
// Foundry's: its snapshot and surface types, its stage regions, its tick rate, the
// sentence a missing surface is failed against, the readings it takes off a drawn
// frame, and every compound sequence that poses this game.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the three control readings, the engine's object model — the open
// world, its game state, its actors and its controllers — the engine's frame
// counter, the cues the engine announced, the assets the build asked for and
// whether each arrived, and — for the rendering checks — the pixels on the canvas
// or the operations the render issued against the 2D context. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the yard through
// the debug surface, and the real ticks the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build:
// `clearStructures` empties the yard and recomputes the route, `placeComponent`
// stands one permanent component up and appends it to the snapshot,
// `setUnitFrozen` holds one unit's travel and nothing else about it, and
// `spawnUnit` releases through the real spawner into a wave whose schedule is
// empty. Posing through it is how a scenario is reproducible, and it is the seam
// the case's specification documents. `surface.ts` is that specification as types,
// and it is the only description of the surface this harness reads: the build's
// own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check. So a
// build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. The package's `readDebugSurface` does
// that read and stands an `absentSurface` in when there is nothing to read, so the
// fault lands on the points whose checks reach the game through the surface rather
// than on the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the IDENTITY strategy, which is what a structured
// engine's state model allows. Each operation is a method acting on the live world
// at the moment of the call — the instance holds the engine, and `engine.world`
// follows transitions — so a pose is `h.debug.setCharge(500)` and a reading is
// `h.debug.snapshot()`, with nothing in between, and the package's
// `identityDriver` names that rather than leaving it implicit. Arc Foundry runs in
// ONE world for the whole session and every screen is a value of the state's
// `screen` field (specs/instrumentation.md), so a pose that changes the screen
// takes effect at the call rather than riding a level transition, and a scenario
// poses and reads with no frame between them.
//
// THE CLOCK IS THE ENGINE'S, AND SO IS THE INPUT. `specs/instrumentation.md` puts
// no clock and no input operation on the surface under an engine, because both
// belong to the runtime: `engine.advance(n)` runs whole frames off a clock this
// harness supplies, and a key or a pointer press is a real event dispatched at the
// engine's own surface, which the game reads through the actions it registered.
// The default clock is a steady 120 Hz, which makes every duration below a whole
// number of frames — and which keeps a projectile's step (`PROJECTILE_SPEED / 120`,
// about 4.3 units) inside its own hit radius, so a shot's arrival is a fact about
// the game rather than about the step size.
//
// AN EDGE IS CONSUMED PER CONTROLLER, WHICH IS WHY A CHECK NEVER READS THE BUILD'S.
// Input reaches the simulation through `PlayerController.input` alone, and reading
// an action's edge consumes THAT controller's copy: a check calling
// `h.world.players()[0].input.pressed("stamp")` takes the press the build's own
// controller was going to read, and the build then behaves as though the key was
// never struck. A check that wants to read an action directly adds a reader of its
// own with {@link observer} and reads that one, which consumes nothing the build
// was owed.
//
// ONE ENGINE PER HARNESS, AND ONE HARNESS PER CHECK. `createHarness` builds a
// fresh canvas, a fresh event target and a fresh engine every time, so every check
// drives a game that has just initialized, with no key held, nothing muted, and
// nothing placed. `dispose` destroys the engine and drops its listeners.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design: one
// operation sets one field. Opening a run, emptying the yard, standing one
// structure up, releasing one held unit, pressing one named control — each of
// those is several operations in a fixed order, and each lives HERE so that a
// hundred suites say what their scenario is about in one line and say it the same
// way. A check that needs only part of a sequence calls the operations it needs.

import { dirname, resolve } from "node:path";
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
  breathe,
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  rasterize,
  type AssetFailure,
  type EngineHarness,
  type EngineHarnessOptions,
  type PointerEventType,
  type TimedCue,
  type UntilOptions,
  type UntilResult as SweepResult,
} from "./case-harness/engine/index";
import {
  deviceOf,
  makeReplayCapture,
  pixelAt,
  sampleColor as sampleCluster,
} from "./case-harness/engine/2d";
import { colorDistance, luminance, type Rgb } from "./case-harness/color";
import { callsTo, setsOf, type DrawCall } from "./case-harness/draw-calls";
import { drawnText } from "./case-harness/text";
import {
  IDENTITY,
  apply,
  numbers,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import { distance, rectCenter, type Rect } from "./case-harness/point";
import type { Pixel } from "./case-harness/pixels";
import {
  type ActionName,
  ASSET_ROOT,
  BACKGROUND,
  BAR_H,
  BOARD_H,
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  type ComboId,
  type ComponentType,
  type DifficultyId,
  keyFor,
  LAYOUT,
  type MapId,
  type MenuAction,
  PANEL_W,
  PANEL_X,
  type PanelAction,
  type Point,
  type PressControl as PressAction,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  type StatusControl as StatusAction,
  structureCenter,
  TARGETING_PRIORITIES,
  tileCenter,
} from "./constants";
import { game as build } from "../src/game";
import { assertTruthy, fail } from "./assert";
import type {
  ComboId as ComboIdent,
  FoundryDebugApi,
  FoundrySnapshot,
  MenuButton,
  OverlayName,
  PanelButton,
  Phase,
  PressButton,
  ReadoutName,
  RecipeEntry,
  Screen,
  SpawnType,
  StatusControl,
  StatusReadout,
  StructureView,
  Targeting,
  Tier,
  UnitView,
} from "./surface";

export {
  READINGS,
  REQUIRED_OPS,
  type FoundrySnapshot,
  type IngredientState,
  type MenuButton,
  type OverlayName,
  type PanelButton,
  type Phase,
  type PressButton,
  type ProjectileView,
  type ReadoutName,
  type RecipeEntry,
  type Screen,
  type StatusControl,
  type StatusReadout,
  type StructureView,
  type Targeting,
  type UnitView,
  type WaypointView,
} from "./surface";

/* The readings this project takes straight off the package, under its names. */
export { callsTo, colorDistance, distance, drawnText, luminance, setsOf };
export type { AssetFailure, DrawCall, Rect, Rgb, TimedCue, UntilOptions };

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. A check that is specifically about the step size builds
// harnesses with clocks of its own; every other check takes the default.

/** The frame the suite steps in. */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Frames of the default clock covering `s` seconds, rounded up. */
const framesFor = (s: number): number => Math.ceil(s * TICK_HZ);

/* -------------------------------------------------------------------------- */
/* What this project is, in the package's terms                               */
/* -------------------------------------------------------------------------- */

/** The case's surface, exactly as `surface.ts` specifies it. */
export type FoundrySurface = FoundryDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain data —
 * so no wrapper stands between a check and the object the build returned, and the
 * driver type is the surface type itself. The alias is kept so a check reads the
 * same way it does under an engine whose surface needs driving.
 */
export type FoundryDriver = FoundrySurface;

/** The engine this project stands a build up on. */
export type FoundryEngine = Engine<FoundrySurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<FoundrySurface>` here and the engine is parameterized with it. A
 * surface that departs from the specification is caught where a check reaches for
 * the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<FoundrySurface>;

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure every check that reaches for a missing surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business — the instance's own `initialize` — and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
 */
export const SURFACE_REQUIREMENT =
  "the debug and automation surface src/game.ts's game instance returns from " +
  "initialize, which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** Fail the running check on `fault`, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * This module's directory, which is the validator project's root, and the build's
 * workspace above it.
 *
 * Taken from this file's own URL rather than from the working directory, because
 * both have to name the same place in the two layouts this file lives in: the
 * case's own `validation/<engine>/`, and the `validation/` the runner stages that
 * directory to inside the build's tree. Neither may be derived inside the package,
 * which is staged one directory DEEPER than this file — a project root taken from
 * there would address every replay and still one directory too far down, and an
 * asset root taken from there would 404 every produced file.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(PROJECT_ROOT, "..");

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */

/**
 * The transport the engine's asset loader fetches through, and the decoder behind
 * it.
 *
 * There is no page behind the engine's asset loader here, so without this every
 * produced file would fail to load and a build whose `initialize` awaits its loads
 * — which is what `specs/assets.md` tells a build to write — would never initialize
 * at all. That would cost the run every point in the project for a fact about NODE.
 *
 * `roots: ["."]` and `onlyUnder: ASSET_ROOT` are this case's, and the pair is the
 * whole of its policy: `specs/assets.md` commits every produced file under
 * `assets/` at the repository root and the loader asks for `assets/<path>`, so the
 * workspace itself is the only root there is to look in — and a relative URL
 * OUTSIDE that subtree is not this shim's to answer, because this project's own
 * modules are loaded by vite rather than fetched. A path under `assets/` the build
 * never produced comes back `404`, exactly as the served site would answer it, so
 * a build that did not produce a required file fails the items about that file and
 * only those.
 *
 * NO `AudioContext` IS INSTALLED, and that is deliberate. Decoding a cue needs Web
 * Audio and a node process has none, so each of the twelve `.wav` files fetches
 * cleanly and settles as a failure whose reason names the missing context. Nothing
 * about a cue is read from the decode: the engine announces every play by name, and
 * that is what the `audio/` points read — while `sprites/assets-load-clean` reads
 * the shape of that one failure and holds every OTHER failure to zero.
 *
 * INSTALLED ONCE PER WORKER, and never taken down: the shims go onto `globalThis`,
 * the package reference-counts them, and a worker that simply exits leaves them
 * standing.
 */
installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: ["."],
  onlyUnder: ASSET_ROOT,
  images: true,
  label: "arc-foundry",
});

/**
 * A no-op `close` over the package's decoder, which is the one member of
 * `ImageBitmap` the package's shim does not supply.
 *
 * `close` is what a browser gives a game for releasing a frame it has finished
 * with, and a build entitled to call it must not fault on the host that decoded the
 * image. The package's `createImageBitmap` answers `@napi-rs/canvas`'s decoded
 * `Image`, which carries no such member, so this wraps it — CASE-LOCALLY, because
 * Arc Foundry is the only case in the tree that ever supplied one. The image object
 * itself is the package's own, mutated rather than replaced, so `AssetHost.sourceOf`
 * still finds the URL it was fetched from.
 */
function nameReleasableImages(): void {
  const scope = globalThis as {
    createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  };
  const decode = scope.createImageBitmap;
  if (decode === undefined) return;
  scope.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> =>
    Object.assign(await decode(blob), { close: () => {} });
}
nameReleasableImages();

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY` and
 * `isPrimary`, and maps the position through the same fit the game draws under.
 *
 * NEITHER OF THE PACKAGE'S TWO. `PointerPositionEvent` names no device, and
 * `specs/controls.md` gives a touch contact reads of its own that the engine tells
 * apart by `pointerType`; `DevicePointerEvent` also states a button MASK, and this
 * case's verdicts were taken under an event that states none — so a build's chord
 * handling sees what it has always seen. See the README's collision table.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerType: "mouse" | "touch";

  constructor(
    type: PointerEventType,
    x: number,
    y: number,
    pointerType: "mouse" | "touch" = "mouse",
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = pointerType;
  }
}

/** How far a sweep runs when a check names no bound of its own. */
const DEFAULT_MAX_FRAMES = 1200;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = SweepResult<FoundrySnapshot>;

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/**
 * What this project reads that the neutral kit does not carry.
 *
 * Everything here is either this engine's own object model (`world`, `state`,
 * `instance`), a reading the specification takes off the frame rather than off the
 * game (`frameCalls`, `probe`), or a vocabulary this case's hundred suites are
 * written in (`advanceSeconds`, the pointer and touch gestures).
 */
export interface FoundryModel {
  /**
   * The world currently open, read fresh on every access.
   *
   * Arc Foundry runs in one world for the whole session (specs/instrumentation.md),
   * so nothing here travels; the accessor is a fresh read regardless, so a check
   * that holds a harness across a scenario is reading the engine rather than a
   * copy.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. Its arrangement is
   * the build's: what the specification fixes is the SNAPSHOT, so a check reads
   * the game through `snapshot()` and comes here only for the engine's own view
   * of the match.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every world. */
  readonly instance: GameInstance<FoundrySurface>;
  /** Every asset the build asked for and got, by path, oldest first. */
  readonly assetLoads: string[];

  /** Run whole frames of the default clock covering `s` seconds of game time. */
  advanceSeconds(s: number): Promise<void>;
  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Reflect the surface without invoking it: `typeof` for each name, and the
   * version it reports.
   */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };
  /** Many logical points at once, each clamped into the backing store. */
  pixels(points: readonly Point[]): Pixel[];

  /** Move the pointer, without pressing. */
  pointerMove(x: number, y: number): void;
  /** Press the pointer at a logical point. */
  pointerDown(x: number, y: number): void;
  /** Release the pointer at a logical point. */
  pointerUp(x: number, y: number): void;

  /**
   * Land a touch contact at a logical point.
   *
   * `specs/controls.md` delivers a contact on the same reads as the pointer and in
   * the same logical units, which under this engine means the same pointer events
   * carrying a touch device. So a contact is dispatched exactly as a pointer act is,
   * and what tells the two apart is the device the engine reads off the event.
   */
  touchStart(x: number, y: number): void;
  /** Move the contact that is down to a logical point. Nothing, with none down. */
  touchMove(x: number, y: number): void;
  /** Lift the contact at the position it is at. Nothing, with none down. */
  touchEnd(): void;
}

/** Everything one harness accumulates while its engine runs, by the engine. */
const arrivals = new WeakMap<object, string[]>();

/**
 * The package's engine machinery, bound to Arc Foundry on this engine.
 *
 * Four of the config's members are where the engines differ, and each is answered
 * here from what THIS engine is:
 *
 *  - `driver` is the identity strategy: this engine's surface is already what a
 *    check calls, so the object the build returned is the driver.
 *  - `toLogical` goes through the open world's CAMERA. The camera opens at its
 *    defaults, so world and logical coordinates coincide — which is the space
 *    every figure in `constants.ts` is stated in — and mapping through it keeps a
 *    reading and a raised pointer honest if a build ever moves it.
 *  - `pointerPrecision` stays `"exact"`, so a raised pointer lands exactly where
 *    the check asked rather than on the nearest device pixel.
 *  - `pointerEvent` is {@link PointerEvt}, this case's own — position and a device,
 *    and no button mask.
 *
 * The recorder is left plain. No `measureText`: {@link textDraws} places a run by
 * walking the frame's own transform operations and reads copy off the anchors, and
 * no point here measures a run's extent. No `internImages`: {@link imageDraws}
 * reads where a blit LANDED, and never which bitmap it was.
 */
const kit = createEngineCaseHarness<
  FoundrySnapshot,
  FoundryDriver,
  FoundryEngine,
  FoundryModel
>({
  slug: "arc-foundry",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    const engine = createEngine<FoundrySurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock: clock as Clock,
      surface: surface as SurfaceMetrics,
    });
    // SUBSCRIBED HERE, WHICH IS BEFORE `initialize`. The kit takes the failures
    // and the cues at this moment and for the same reason; the arrivals are the
    // other half of `sprites/assets-load-clean`'s census, and construction runs no
    // game code, so nothing the build asked for has happened yet.
    const loaded: string[] = [];
    arrivals.set(engine, loaded);
    engine.events.on("asset:loaded", ({ path }) => {
      loaded.push(path);
    });
    return engine;
  },
  driver: (_engine, raw) => identityDriver(raw as FoundryDriver),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "exact",
  pointerEvent: (type, x, y, device) =>
    new PointerEvt(type, x, y, device === "touch" ? "touch" : "mouse"),
  extend: (base, engine, initialized) => {
    // Captured BEFORE the kit defines this object's members over `base`, because
    // two of them are replaced below and reading them off the harness afterwards
    // would reach the replacement rather than the kit's own.
    const runFrames = base.advance;
    const readSnapshot = base.snapshot;

    // WHY A DRIVE HANDS THE EVENT LOOP A TURN. `engine.advance(n)` returns a
    // promise, but the `n` frames have already run by the time it does: the engine
    // steps them synchronously and resolves after the last one. So a check that
    // drives a wave to its clear holds this worker's event loop for as long as that
    // simulation takes, and awaiting an already-settled promise does not give the
    // loop back. Vitest reports a running file to its runner over a socket served
    // by that same loop, and a report left unanswered for long enough is abandoned,
    // which spoils the RUN over a check that passed. The package's `breathe` lets
    // one real turn of the loop through whenever the frames just run have held it
    // too long. Nothing measured here depends on wall-clock time — every check
    // supplies its own clock and the engine reads no other — so the turn changes no
    // reading.
    let since = Date.now();
    const step = async (frames: number): Promise<void> => {
      await runFrames(frames);
      since = await breathe(since);
    };

    /**
     * A logical point's pixel in the backing store, CLAMPED into it.
     *
     * The letterbox checks read at a surface wider than the stage, where a point
     * on the stage's own edge maps onto the boundary of the store; clamping is what
     * keeps such a read a colour rather than an exception from `getImageData`.
     */
    const pixels = (points: readonly Point[]): Pixel[] => {
      const view = engine.viewport();
      const world = engine.world;
      const store = base.canvas;
      return points.map((point) => {
        const logical = world.camera.worldToLogical(point);
        const at = deviceOf(view, logical.x, logical.y);
        return pixelAt(base.ctx, {
          x: Math.min(Math.max(at.x, 0), Math.max(store.width - 1, 0)),
          y: Math.min(Math.max(at.y, 0), Math.max(store.height - 1, 0)),
        });
      });
    };

    // Where the one touch contact is, or `null` with none down.
    // `specs/instrumentation.md` holds one contact down at a time, lifts it "at the
    // position it is at", and ignores a move or an end with none down.
    let contact: Point | null = null;

    const model = {
      get world() {
        return engine.world;
      },
      get state() {
        return engine.world.state;
      },
      instance: initialized as GameInstance<FoundrySurface>,
      assetLoads: arrivals.get(engine) ?? [],

      advance: step,
      advanceSeconds: (s: number) => step(framesFor(s)),

      async until(
        predicate: (snapshot: FoundrySnapshot) => boolean,
        options: UntilOptions = {},
      ): Promise<UntilResult> {
        // NOT the kit's own sweep, and the difference is the CEILING: this project
        // drives waves that run for many hundreds of frames, and it has always
        // swept to 1200 where the package's default stops at 600. A sweep that gave
        // up early would report `hit: false` about a game that was still going.
        // Everything else is the kit's, `breathe` included.
        const maxFrames =
          options.maxFrames ?? options.maxTicks ?? DEFAULT_MAX_FRAMES;
        const poll = Math.max(1, options.poll ?? 1);

        let snapshot = readSnapshot();
        if (predicate(snapshot)) {
          return { hit: true, frames: 0, ticks: 0, snapshot };
        }

        let frames = 0;
        while (frames < maxFrames) {
          const chunk = Math.min(poll, maxFrames - frames);
          await step(chunk);
          frames += chunk;
          snapshot = readSnapshot();
          if (predicate(snapshot)) {
            return { hit: true, frames, ticks: frames, snapshot };
          }
        }
        return { hit: false, frames, ticks: frames, snapshot };
      },

      async frameCalls(): Promise<DrawCall[]> {
        base.calls.length = 0;
        await step(1);
        return [...base.calls];
      },

      probe(names: readonly string[]) {
        // Through the DRIVER rather than around it: a member that is not a function
        // comes back untouched, so an operation the build left out reads
        // `"undefined"` and the version reads the number the build reported.
        const target = base.debug as unknown as Record<string, unknown>;
        const ops: Record<string, string> = {};
        for (const name of names) ops[name] = typeof target[name];
        return { version: target.version, ops };
      },

      pixels,
      pixel: (x: number, y: number): Pixel => pixels([{ x, y }])[0] as Pixel,

      pointerMove: (x: number, y: number) => base.pointer("pointermove", x, y),
      pointerDown: (x: number, y: number) => base.pointer("pointerdown", x, y),
      pointerUp: (x: number, y: number) => base.pointer("pointerup", x, y),

      touchStart: (x: number, y: number) => {
        contact = { x, y };
        base.pointer("pointerdown", x, y, "touch");
      },
      touchMove: (x: number, y: number) => {
        if (contact === null) return;
        contact = { x, y };
        base.pointer("pointermove", x, y, "touch");
      },
      touchEnd: () => {
        if (contact === null) return;
        const at = contact;
        contact = null;
        base.pointer("pointerup", at.x, at.y, "touch");
      },
    };
    return model as FoundryModel;
  },
});

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<
  FoundrySnapshot,
  FoundryDriver,
  FoundryEngine
> &
  FoundryModel;

/**
 * Build an engine over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the touch layout — so one harness serves every build of this case. Everything
 * else the build decided lives inside `src/game.ts`.
 *
 * EVERY PRODUCED FILE IS SERVED, to every check without exception: the transport
 * above stands before the first harness is built, so the engine resolves, requests,
 * decodes and announces exactly as it does in a page, and the build asks for its
 * files exactly as it always does.
 */
export const createHarness = kit.createHarness;

/**
 * A reader of the frame's input that consumes nothing the build was owed.
 *
 * An action's edge is consumed PER CONTROLLER: `pressed` reports the edge once for
 * each controller that asks, and the call takes that controller's copy. So a check
 * that read `h.world.players()[0].input.pressed("stamp")` would take the press the
 * build's own controller was going to read, and the build would behave as though
 * the key was never struck — a check that measured the harness rather than the
 * game.
 *
 * This adds a player of the harness's own instead, holding the ENGINE's plain
 * `PlayerController` rather than whatever class the build named, so it possesses
 * nothing, ticks to no effect, and only ever answers what the frame's input was.
 * The build's controller keeps its own copy of every edge, and its player stays
 * first in `world.players()`.
 *
 * One per harness is enough: the reader lives as long as the world does, and Arc
 * Foundry runs in one world for the whole session.
 */
export function observer(h: Harness): PlayerController {
  return h.world.mode.addPlayer({
    name: "validator-observer",
    controller: PlayerController,
    pawn: null,
  });
}

/** Seconds of simulated time in `n` frames of the default clock. */
export const seconds = kit.seconds;

/** Frames of the default clock covering `s` seconds, rounded up. */
export const ticks = kit.ticks;

/** A speed in units per second from a displacement measured over `n` frames. */
export const speedOverTicks = kit.speedOverTicks;

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so the
 * handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the kill
 * — which is what tells a build that plays its cue on the right event apart from
 * one that plays it on every frame, or a frame late.
 *
 * The cue's NAME is the engine's to report, so a check names the cue it expects:
 * a build that plays its leak blip on every kill is caught here.
 */
export const watchCues = kit.watchCues;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Both are evidence, never a verdict: the scenario's own value comes straight back,
// a scenario that throws still leaves what it recorded, a capture that closed no
// frames writes nothing, and outside a run the media directory is unset and the
// whole thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const cleared = await captureReplay(h, "wave", () => clearWave(h));
 * assertEqual(cleared.hit, true);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them.
 */
export const captureReplay = makeReplayCapture("arc-foundry", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one PICTURE
 * rather than a stretch of motion: which screen the game opened on, what the
 * inspector drew for a selected structure, how the recipe book laid its twelve out.
 *
 * What is written is whatever the last frame that RAN left behind, so call it after
 * the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// A snapshot is a plain document, so these are pure functions over one. They exist
// so that a check reads what it is about by name and fails by assertion when the
// thing it named is not there, rather than dereferencing `undefined` a few lines
// later and reporting a `TypeError` where a verdict belonged.

/** The live unit of that id, or a failure naming the id and what was on the yard. */
export function unitById(snapshot: FoundrySnapshot, id: number): UnitView {
  const found = snapshot.units.find((u) => u.id === id);
  assertTruthy(
    found,
    `snapshot().units to carry the unit #${id}; it carries ${
      snapshot.units.length === 0
        ? "none"
        : snapshot.units.map((u) => `#${u.id}`).join(", ")
    }`,
  );
  return found as UnitView;
}

/** The structure of that id, or a failure naming the id and what was on the yard. */
export function structureById(
  snapshot: FoundrySnapshot,
  id: number,
): StructureView {
  const found = snapshot.structures.find((s) => s.id === id);
  assertTruthy(
    found,
    `snapshot().structures to carry the structure #${id}; it carries ${
      snapshot.structures.length === 0
        ? "none"
        : snapshot.structures.map((s) => `#${s.id}`).join(", ")
    }`,
  );
  return found as StructureView;
}

/**
 * The last unit the snapshot reports, which `specs/instrumentation.md` fixes as the
 * one `spawnUnit` just released.
 */
export function lastUnit(snapshot: FoundrySnapshot): UnitView {
  const found = snapshot.units[snapshot.units.length - 1];
  assertTruthy(
    found,
    "snapshot().units to carry the unit spawnUnit just released, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as UnitView;
}

/**
 * The last structure the snapshot reports, which `specs/instrumentation.md` fixes
 * as the one the `place` operation just stood up.
 */
export function lastStructure(snapshot: FoundrySnapshot): StructureView {
  const found = snapshot.structures[snapshot.structures.length - 1];
  assertTruthy(
    found,
    "snapshot().structures to carry the structure just placed, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as StructureView;
}

/** The structure anchored at that tile, or `undefined`. */
export function structureAt(
  snapshot: FoundrySnapshot,
  col: number,
  row: number,
): StructureView | undefined {
  return snapshot.structures.find((s) => s.col === col && s.row === row);
}

/** Every structure that fires: the seven firing base types and the towers. */
export function firingStructures(snapshot: FoundrySnapshot): StructureView[] {
  return snapshot.structures.filter((s) => s.targeting !== null);
}

/**
 * The progress ordering of `specs/pathing.md`, furthest along the chain first.
 *
 * Compared first by the checkpoint the unit is heading for, and then, among units
 * heading for the same one, by the REMAINING route length to it — so a shorter
 * `progress` is further along. This is the ordering `first` and `last` select on,
 * and the tie-break every targeting priority resolves toward.
 */
export function compareAlongChain(a: UnitView, b: UnitView): number {
  if (a.waypointIndex !== b.waypointIndex) {
    return b.waypointIndex - a.waypointIndex;
  }
  return a.progress - b.progress;
}

/** The units of a snapshot, ordered furthest along the chain first. */
export function alongChain(snapshot: FoundrySnapshot): UnitView[] {
  return [...snapshot.units].sort(compareAlongChain);
}

/** The priority `steps` activations of the targeting control past `current`. */
export function targetingAfter(current: Targeting, steps: number): Targeting {
  const at = TARGETING_PRIORITIES.indexOf(current);
  assertTruthy(at >= 0, `a targeting priority; received ${String(current)}`);
  const n = TARGETING_PRIORITIES.length;
  return TARGETING_PRIORITIES[(at + (steps % n) + n) % n]!;
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic by design, so opening a run, emptying the yard, standing
// one structure up and releasing one held unit are each several operations in a
// fixed order. Every one of them lives here, so a suite says what its scenario is
// about in one line and every suite says it the same way. A check that needs only
// part of a sequence calls the operations it needs.
//
// Nothing here poses an outcome. Each of these arranges a precondition through the
// same systems play uses — a placed rock rolls through the real press, a released
// unit walks the real pathfinder — and what happens next comes from advancing the
// real simulation.

/** What a run opens as, and what the yard holds when it opens. */
export interface YardOptions {
  /** The map the run opens on. Defaults to the reset value, `substation`. */
  map?: MapId;
  /** The difficulty. Defaults to the reset value, `medium`. */
  difficulty?: DifficultyId;
  /** The seed every random draw runs off. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The wave units released from now on scale to. */
  wave?: number;
  /** Charge in the bank. */
  charge?: number;
  /** Grid Integrity remaining. */
  integrity?: number;
  /** The refinement level, and with it the roll odds. */
  refinement?: number;
  /** The stamps left in the level's allowance. */
  stamps?: number;
  /** The speed multiplier. Defaults to the reset value, `1`. */
  speed?: number;
}

/**
 * A run at its first build phase, entered the way choosing a difficulty enters
 * one: reset to the title, choose the map and the difficulty, start the run.
 *
 * What it arranges is exactly the opening allocation `specs/campaign.md` states,
 * because `startRun` takes the path confirming the difficulty select takes.
 */
export function openRun(h: Harness, options: YardOptions = {}): void {
  h.debug.reset(
    options.seed === undefined ? undefined : { seed: options.seed },
  );
  if (options.map !== undefined) h.debug.setMap(options.map);
  if (options.difficulty !== undefined)
    h.debug.setDifficulty(options.difficulty);
  h.debug.startRun();
}

/**
 * Everything off the yard: every structure, every live unit, every projectile.
 *
 * The isolation the validator guide asks for, in one line. `clearStructures` also
 * clears the selection and the combine set and recomputes the route, and
 * `clearUnits` kills nothing and leaks nothing, so no bounty is paid and no Grid
 * Integrity is lost by emptying the yard.
 */
export function emptyYard(h: Harness): void {
  h.debug.clearStructures();
  h.debug.clearUnits();
  h.debug.clearProjectiles();
}

/**
 * THE OPENING LINE OF ALMOST EVERY CHECK: a run on an empty yard, posed to the
 * resources and the progress the scenario needs.
 *
 * The order matters and is fixed here so no suite has to think about it: the run
 * opens first, because `startRun` installs the opening allocation over anything
 * posed before it, and the resources are posed after, because a check that wants
 * `500` Charge wants it whatever the run opened with.
 */
export function openYard(h: Harness, options: YardOptions = {}): void {
  openRun(h, options);
  emptyYard(h);
  if (options.wave !== undefined) h.debug.setWave(options.wave);
  if (options.charge !== undefined) h.debug.setCharge(options.charge);
  if (options.integrity !== undefined) h.debug.setIntegrity(options.integrity);
  if (options.refinement !== undefined) {
    h.debug.setRefinement(options.refinement);
  }
  if (options.stamps !== undefined) h.debug.setStamps(options.stamps);
  if (options.speed !== undefined) h.debug.setSpeed(options.speed);
}

/**
 * Put away whatever is held on the cursor, THROUGH THE PLAYER'S `back` CONTROL.
 *
 * This drives a real key at the engine's surface, so it exercises the `back`
 * binding and the cancel rule of `specs/controls.md` and costs the one frame that
 * delivers the edge. That is a requirement of its own, decided by
 * `input/back-held-rock` and `press/cancel-is-free`, so ONLY the checks that are
 * about those two use this.
 *
 * Every other check that needs an empty cursor poses it with {@link putAwayHeld},
 * which is the surface's own `clearHeld` and reaches no unrelated control.
 */
export async function clearHand(h: Harness): Promise<void> {
  await pressAction(h, "back");
}

/**
 * Put away whatever is held on the cursor, as a POSE.
 *
 * `placeRock` goes through the real continuous-placement path, so it re-arms the
 * press the moment the rock lands while stamps remain (`specs/scrap-press.md`), and
 * the panel then shows the held-rock read rather than the inspector —
 * `panelButtons` comes back EMPTY. A scenario that is about anything other than the
 * held rock therefore has one on the cursor it never asked for, and `clearHeld` is
 * the operation `specs/instrumentation.md` carries to remove it: it spends no stamp,
 * changes nothing else, and runs no frame.
 */
export function putAwayHeld(h: Harness): void {
  h.debug.clearHeld();
}

/** Refill the level's stamp allowance, for a scenario that needs a sixth rock. */
export function refillStamps(h: Harness): void {
  h.debug.setStamps(STAMPS_PER_LEVEL);
}

/* ---- Standing one structure up -------------------------------------------- */
//
// Each of these stands exactly one thing on the yard and hands back its id, read
// off the snapshot's last entry as `specs/instrumentation.md` fixes it. Each
// asserts the placement landed, so a scenario that asked for an anchor the
// never-seal rule refuses fails where it asked rather than several frames later
// with a structure it never got.

/** The id the structure a `place` operation just appended carries. */
function placed(
  snapshot: FoundrySnapshot,
  before: number,
  what: string,
): number {
  assertTruthy(
    snapshot.structures.length === before + 1,
    `${what} to stand one structure up and append it to snapshot().structures ` +
      `(specs/instrumentation.md); the yard went from ${before} structures to ` +
      `${snapshot.structures.length}`,
  );
  return lastStructure(snapshot).id;
}

/** A permanent firing component of that type and quality, at that anchor. */
export function standComponent(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const before = h.snapshot().structures.length;
  h.debug.placeComponent(type, quality, col, row);
  return placed(
    h.snapshot(),
    before,
    `placeComponent(${type}, ${quality}, ${col}, ${row})`,
  );
}

/** A combination tower at that anchor, landed at level `0` and raised to `level`. */
export function standCombo(
  h: Harness,
  combo: ComboId,
  col: number,
  row: number,
  level = 0,
): number {
  const before = h.snapshot().structures.length;
  h.debug.placeCombo(combo, col, row);
  const id = placed(
    h.snapshot(),
    before,
    `placeCombo(${combo}, ${col}, ${row})`,
  );
  if (level !== 0) h.debug.setComboLevel(id, level);
  return id;
}

/** An inert blocker at that anchor: a wall with no head and no glow. */
export function standBlocker(h: Harness, col: number, row: number): number {
  const before = h.snapshot().structures.length;
  h.debug.placeBlocker(col, row);
  return placed(h.snapshot(), before, `placeBlocker(${col}, ${row})`);
}

/**
 * A candidate of a chosen type and quality, dropped through the real press.
 *
 * The roll is armed first, so the rock that lands rolls exactly what the scenario
 * asked for; the drop itself still goes through the placement path, so it spends a
 * stamp and is refused exactly where a pointer press would be.
 *
 * THE HAND IS LEFT EMPTY, AND NOTHING UNRELATED IS TOUCHED TO DO IT. Placement is
 * continuous (`specs/scrap-press.md`), so the drop arms another rock on the cursor
 * while stamps remain, and the panel would show the held-rock read rather than the
 * inspector. `clearHeld` puts that rock away — the surface's own pose for it,
 * spending no stamp and changing nothing else — so the yard the check reads is the
 * one the drop left, one stamp lighter, with an empty cursor. No control is pressed
 * and no frame runs.
 */
export function standCandidate(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const opening = h.snapshot();
  const before = opening.structures.length;
  const stamps = opening.stampsLeft;
  assertTruthy(
    stamps > 0,
    `the level's stamp allowance to have a stamp left for a rock at ` +
      `(${col}, ${row}); stampsLeft is ${stamps}`,
  );
  h.debug.setNextRoll(type, quality);
  h.debug.placeRock(col, row);
  h.debug.clearNextRoll();
  h.debug.clearHeld();
  return placed(
    h.snapshot(),
    before,
    `placeRock(${col}, ${row}) armed to roll ${type} at quality ${quality}`,
  );
}

/** Select a structure, as a pointer press on it would. */
export function selectStructure(h: Harness, id: number): void {
  h.debug.select(id);
}

/* ---- Releasing one unit --------------------------------------------------- */

/**
 * How a released unit is posed, one faculty at a time.
 *
 * Isolation reaches inside the entity: a check about a burn's damage wants a unit
 * that burns and does not walk, and a check about a slow's expiry wants one that
 * walks and carries a slow. So each faculty a scenario must hold is its own field
 * here, and every one it leaves out is left exactly as the spawner set it.
 */
export interface UnitPose {
  /** A logical position to stand it at. */
  at?: Point;
  /** Or the center of a tile to stand it at. */
  tile?: { col: number; row: number };
  /** The checkpoint it heads for, `1`–`7`, where `7` is the collector. */
  waypoint?: number;
  /** Its current health, at least `1` and at most its maximum. */
  hp?: number;
  /** A slow, applied through the rule `specs/enemies.md` fixes. */
  slow?: { amount: number; seconds: number };
  /** A burn, applied through the same rule, credited to no structure. */
  burn?: { dps: number; seconds: number };
  /** Travel held, and nothing else held with it. */
  frozen?: boolean;
}

/**
 * One unit of that type at the map's entry, scaled to the current wave, posed.
 *
 * `spawnUnit` releases through the real spawner and so puts the run into a live
 * wave whose spawn schedule is empty: the units on the yard are exactly the ones
 * released here and nothing else arrives. That wave clears the ordinary way, when
 * every one of them has died or leaked, and clearing it pays the ordinary wave-clear
 * bonus — so a check reading `charge` after a kill either holds that resolution with
 * {@link holdWaveClear} or expects the bounty and the bonus.
 *
 * The poses are applied in the order `specs/instrumentation.md` leaves them
 * independent in: the checkpoint first, because setting it moves the unit nowhere,
 * then the position, then the health, then the statuses, and the travel hold last so
 * nothing after it has to think about whether the unit moved.
 */
export function releaseUnit(
  h: Harness,
  type: SpawnType,
  pose: UnitPose = {},
): number {
  const before = h.snapshot().units.length;
  h.debug.spawnUnit(type);
  const after = h.snapshot();
  assertTruthy(
    after.units.length === before + 1,
    `spawnUnit(${type}) to release one unit and append it to snapshot().units ` +
      `(specs/instrumentation.md); the yard went from ${before} units to ` +
      `${after.units.length}`,
  );
  const id = lastUnit(after).id;

  if (pose.waypoint !== undefined) h.debug.setUnitWaypoint(id, pose.waypoint);
  const at =
    pose.at ??
    (pose.tile === undefined
      ? undefined
      : tileCenter(pose.tile.col, pose.tile.row));
  if (at !== undefined) h.debug.setUnitPosition(id, at.x, at.y);
  if (pose.hp !== undefined) h.debug.setUnitHp(id, pose.hp);
  if (pose.slow !== undefined) {
    h.debug.setUnitSlow(id, pose.slow.amount, pose.slow.seconds);
  }
  if (pose.burn !== undefined) {
    h.debug.setUnitBurn(id, pose.burn.dps, pose.burn.seconds);
  }
  if (pose.frozen !== undefined) h.debug.setUnitFrozen(id, pose.frozen);
  return id;
}

/**
 * One unit standing still at a chosen point, keeping every faculty but travel.
 *
 * The workhorse of this project. A held unit is targetable, it takes damage, its
 * burn ticks, its slow runs down and expires, and its body holds the position it
 * was posed at however long the scenario runs — so a check about damage, about a
 * status effect, or about which unit a priority picks reads a number that moved for
 * exactly one reason.
 */
export function parkUnit(
  h: Harness,
  type: SpawnType,
  at: Point,
  pose: Omit<UnitPose, "at" | "tile" | "frozen"> = {},
): number {
  return releaseUnit(h, type, { ...pose, at, frozen: true });
}

/* ---- Holding the run's own faculties -------------------------------------- */
//
// Two of the run's faculties are gated by the surface rather than staged around,
// because a check that staged around them would be reading unrelated systems. Each
// is its own operation (`specs/instrumentation.md`), so a scenario holds exactly
// the faculty its requirement does not exercise and nothing else.

/**
 * Put the run into a phase, without releasing a unit and without composing a wave.
 *
 * A check about what the panel or the bar does DURING A WAVE is about the phase,
 * not about a unit: `setPhase("wave")` opens a live wave whose spawn schedule is
 * empty, so the yard stays exactly as the check posed it and the only thing that
 * changed is the phase the requirement names.
 */
export function enterPhase(h: Harness, phase: Phase): void {
  h.debug.setPhase(phase);
}

/**
 * The wave phase, posed and held open: the phase almost every such check wants.
 *
 * A posed wave's spawn schedule is empty, so with nothing on the yard it would clear
 * on the very next advance and pay its wave-clear bonus into whatever the check is
 * reading. So the clear-and-pay resolution is held with it. These are two atomic
 * operations of the surface and one sequence here, which is where a compound belongs.
 * A check that wants the wave to be able to clear poses the phase with
 * {@link enterPhase} and leaves the hold off.
 */
export function enterWave(h: Harness): void {
  enterPhase(h, "wave");
  holdWaveClear(h);
}

/**
 * Hold the running wave's own clear-and-pay resolution, so it cannot end under a
 * reading.
 *
 * Clearing a wave pays the wave-clear bonus, and a bonus landing in the middle of a
 * check that is reading `charge` would be indistinguishable from the bounty it was
 * measuring. `setWaveHold` holds THAT resolution and nothing else — bounties are
 * still paid, leaks still cost Grid Integrity, and defeat still resolves — so a
 * check separates the two without keeping a bystander unit alive to do it.
 */
export function holdWaveClear(h: Harness, held = true): void {
  h.debug.setWaveHold(held);
}

/**
 * Commit the level's harvest, which is what starts the wave.
 *
 * There is no send control (`specs/campaign.md`): a wave begins when a candidate is
 * kept, downgraded, or folded into a combine. So this stands one candidate at the
 * anchor given and keeps it, and the wave the level composed starts on the next
 * advance. The component it leaves standing is the one the harvest produced, and its
 * id comes back.
 */
export function startWave(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const candidate = standCandidate(h, type, quality, col, row);
  h.debug.keep(candidate);
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */
//
// A control is found by the action it carries rather than by where it was drawn,
// because `specs/hud.md` fixes each menu's content and navigation and leaves its
// layout to the build. The rectangle a reading reports is the control's real hit
// region, so pressing the center of a reported, non-disabled rectangle activates it
// — which is how a check operates the game the way a player does without knowing
// anything about the build's layout.

/**
 * A rectangle a reading reports.
 *
 * The package's, because a rectangle is a rectangle: every control the surface
 * reports already carries these four fields, so it IS one of these and needs no
 * conversion.
 */
export type ControlRect = Rect;

/** The center of a reported control rectangle. */
export const controlCenter = rectCenter;

/**
 * A point on the stage inside none of `rects`.
 *
 * `specs/ui.md` gives an edge "outside every region" an outcome of its own, and
 * where a menu draws its entries is the build's, so a point outside every one of
 * them is SEARCHED FOR over the stage rather than named here: a build that draws
 * its menu somewhere else still has the point decided against its own layout. The
 * stage is walked on a coarse lattice, inset from the edges so the point is one a
 * player could really put a finger on, and the first square inside no reported
 * rectangle is taken.
 */
export function pointOutside(rects: readonly ControlRect[]): Point {
  const STEP = 20;
  const INSET = 10;
  for (let y = INSET; y <= STAGE_H - INSET; y += STEP) {
    for (let x = INSET; x <= STAGE_W - INSET; x += STEP) {
      const covered = rects.some(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
      );
      if (!covered) return { x, y };
    }
  }
  return fail(
    "somewhere on the stage outside every reported menu rectangle",
    "every point covered by one",
  );
}

/**
 * A press and a release at a logical point: one click, and the frame that delivers
 * it.
 *
 * The pointer is moved onto the point before the press, because that is what a real
 * pointer does and because a build is entitled to hover before it commits. Both
 * edges are delivered before the frame runs, because `specs/ui.md` takes a menu
 * entry "only when both edges of the gesture fall inside one entry's region": a
 * click whose release never reached the game would take no entry at all.
 */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointerMove(x, y);
  h.pointerDown(x, y);
  h.pointerUp(x, y);
  await h.advance(1);
}

/**
 * Move the pointer onto a logical point, without pressing.
 *
 * `specs/controls.md` gives a bare move effects of its own — the menu highlight
 * follows it, the held footprint snaps under it — so a check about a hover delivers
 * the move alone and nothing else.
 */
export async function hoverAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointerMove(x, y);
  await h.advance(1);
}

/** Move the pointer onto the center of a reported control rectangle. */
export function hoverControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return hoverAt(h, point.x, point.y);
}

/**
 * Press at one logical point and release at another.
 *
 * The gesture `specs/ui.md` takes no entry for: "Two edges in different regions take
 * no entry, and an edge outside every region takes none."
 */
export async function pointerDrag(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  h.pointerMove(from.x, from.y);
  h.pointerDown(from.x, from.y);
  h.pointerMove(to.x, to.y);
  h.pointerUp(to.x, to.y);
  await h.advance(1);
}

/** A touch contact landing and lifting at one logical point: a tap. */
export async function tapAt(h: Harness, x: number, y: number): Promise<void> {
  h.touchStart(x, y);
  h.touchEnd();
  await h.advance(1);
}

/** Tap the center of a reported control rectangle. */
export function tapControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return tapAt(h, point.x, point.y);
}

/**
 * Land a touch contact at one logical point and travel it to another, leaving it
 * down, so what the travel alone changes can be read before the lift.
 */
export async function touchOnto(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  h.touchStart(from.x, from.y);
  h.touchMove(to.x, to.y);
  await h.advance(1);
}

/** Land a contact at one logical point, travel it to another, and lift it there. */
export async function touchDrag(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  h.touchStart(from.x, from.y);
  h.touchMove(to.x, to.y);
  h.touchEnd();
  await h.advance(1);
}

/** A click at the center of a tile. */
export function clickTile(h: Harness, col: number, row: number): Promise<void> {
  const point = tileCenter(col, row);
  return clickAt(h, point.x, point.y);
}

/** A click at the center of a structure anchored at that tile. */
export function clickStructure(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = structureCenter(col, row);
  return clickAt(h, point.x, point.y);
}

/** A click at the center of a reported control rectangle. */
export function clickControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return clickAt(h, point.x, point.y);
}

function describeControls(drawn: readonly { action: string }[]): string {
  return drawn.length === 0
    ? "none"
    : drawn.map((c) => `\`${c.action}\``).join(", ");
}

/** The inspector's control carrying that action, or a failure naming what was drawn. */
export function panelControl(
  h: Harness,
  action: PanelAction,
  label?: string,
): PanelButton {
  const drawn = h.debug.panelButtons();
  const found = drawn.find(
    (b) => b.action === action && (label === undefined || b.label === label),
  );
  assertTruthy(
    found,
    `panelButtons() to carry a \`${action}\` control${
      label === undefined ? "" : ` labelled ${label}`
    } (specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PanelButton;
}

/** The panel's own control carrying that action, or a failure naming what was drawn. */
export function pressControl(h: Harness, action: PressAction): PressButton {
  const drawn = h.debug.pressControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `pressControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PressButton;
}

/** The menu choice carrying that action, or a failure naming what was drawn. */
export function menuControl(h: Harness, action: MenuAction): MenuButton {
  const drawn = h.debug.menuButtons();
  const found = drawn.find((b) => b.action === action);
  assertTruthy(
    found,
    `menuButtons() to carry a \`${action}\` choice (specs/instrumentation.md); ` +
      `it carries ${describeControls(drawn)}`,
  );
  return found as MenuButton;
}

/** The status-bar control carrying that action, or a failure naming what was drawn. */
export function statusControl(h: Harness, action: StatusAction): StatusControl {
  const drawn = h.debug.statusControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `statusControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as StatusControl;
}

/** The status bar's read carrying that name, or a failure naming what was drawn. */
export function statusReadout(h: Harness, readout: ReadoutName): StatusReadout {
  const drawn = h.debug.statusReadouts();
  const found = drawn.find((r) => r.readout === readout);
  assertTruthy(
    found,
    `statusReadouts() to carry a \`${readout}\` read ` +
      `(specs/instrumentation.md); it carries ${
        drawn.length === 0
          ? "none"
          : drawn.map((r) => `\`${r.readout}\``).join(", ")
      }`,
  );
  return found as StatusReadout;
}

/**
 * The recipe book's cell for one ingredient of one recipe.
 *
 * A recipe may name the same component type twice, so a cell is found by the
 * recipe it belongs to AND the ingredient's index within it, which is what
 * `specs/instrumentation.md` gives `combo` and `ingredient` for.
 */
export function recipeCell(
  h: Harness,
  combo: ComboIdent,
  ingredient: number,
): RecipeEntry {
  const drawn = h.debug.recipeEntries();
  const found = drawn.find(
    (e) => e.combo === combo && e.ingredient === ingredient,
  );
  assertTruthy(
    found,
    `recipeEntries() to carry ingredient ${ingredient} of the \`${combo}\` ` +
      `recipe (specs/instrumentation.md); it carries ${drawn.length} cells ` +
      `covering ${new Set(drawn.map((e) => e.combo)).size} recipes`,
  );
  return found as RecipeEntry;
}

/** Every cell the book drew for one recipe, in the recipe's own ingredient order. */
export function recipeCells(h: Harness, combo: ComboIdent): RecipeEntry[] {
  return h.debug
    .recipeEntries()
    .filter((e) => e.combo === combo)
    .sort((a, b) => a.ingredient - b.ingredient);
}

/** Find the inspector's control by action and press its center. */
export function pressPanel(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<void> {
  return clickControl(h, panelControl(h, action, label));
}

/** Find the panel's own control by action and press its center. */
export function pressPressControl(
  h: Harness,
  action: PressAction,
): Promise<void> {
  return clickControl(h, pressControl(h, action));
}

/** Find the menu choice by action and press its center. */
export function pressMenu(h: Harness, action: MenuAction): Promise<void> {
  return clickControl(h, menuControl(h, action));
}

/** Find the status-bar control by action and press its center. */
export function pressStatus(h: Harness, action: StatusAction): Promise<void> {
  return clickControl(h, statusControl(h, action));
}

/**
 * Fire one action from the keyboard, through the engine's own input path.
 *
 * A real press and release of the key `specs/controls.md` binds the action to,
 * dispatched at the engine's surface, and the one frame that delivers the edge. The
 * engine discards an edge nothing consumed by the end of the frame it was armed in,
 * so the frame is what makes the press reach the game.
 *
 * Every action but `modify` is read as a press edge, so this fires it exactly once.
 * `modify` is read as a level and is held with {@link withModify} instead.
 */
export function pressAction(h: Harness, action: ActionName): Promise<void> {
  return h.tap(keyFor(action));
}

/**
 * Run `body` with the `modify` action held, as a player holding Shift does.
 *
 * `modify` is read as a level rather than as an edge: what the game reads is whether
 * its key is down at the moment it reads it, so it modifies whatever act it is held
 * across — which means `body` must run the frame that resolves the press. The
 * release is in a `finally`, so a failing body cannot leave the key down under the
 * check that runs next.
 */
export async function withModify<T>(
  h: Harness,
  body: () => T | Promise<T>,
): Promise<T> {
  const key = keyFor("modify");
  h.hold(key);
  try {
    return await body();
  } finally {
    h.release(key);
  }
}

/**
 * Show a menu screen and hand back the choices it presents, in order.
 *
 * `setScreen` moves to the screen exactly as reaching it in play does, and
 * `menuButtons` is a pure reading of the state, so the choices come back without the
 * check advancing anything.
 */
export function openMenu(h: Harness, screen: Screen): MenuButton[] {
  h.debug.setScreen(screen);
  return h.debug.menuButtons();
}

/**
 * Open or close a read-only overlay, and confirm the snapshot agrees.
 *
 * Both overlays are inert (`specs/hud.md`): opening one changes what is drawn and
 * nothing else, so this is an arrangement rather than an act.
 */
export function setOverlay(
  h: Harness,
  overlay: OverlayName,
  open: boolean,
): void {
  h.debug.setOverlay(overlay, open);
}

/* -------------------------------------------------------------------------- */
/* Colour, read off the rendered canvas                                       */
/* -------------------------------------------------------------------------- */
//
// The palette is the build's own (`specs/overview.md`), so nothing here knows a
// colour: the samplers compare what was painted against what else was painted, or
// against the background the build declared. `colorDistance` and `luminance` are
// the package's, re-exported above; only the SPREAD is this case's.

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours `spread` units out, which is the package's
 * cluster — under this case's own default of TWO units rather than the package's
 * four. Sample at least two logical pixels inside an edge: an edge is anti-aliased
 * and blends toward whatever is behind it, and only an interior pixel is the fill.
 * The default is bound here rather than taken from the package because this case's
 * smallest sampled body is two units across, and a wider cluster would read its
 * surroundings.
 */
export function sampleColor(h: Harness, x: number, y: number, spread = 2): Rgb {
  return sampleCluster(h, x, y, spread);
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame, read back through the same canvas implementation the
 * harness samples with, so a pixel the game never drew over compares against it
 * exactly.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterize(BACKGROUND);
  return { r, g, b };
}

/* -------------------------------------------------------------------------- */
/* What a check reads off one drawn frame                                     */
/* -------------------------------------------------------------------------- */
//
// Everything below is a pure function over one frame's recorded operations or
// over a grid of sampled pixels, and every category that decides a point from
// what the build DREW reads it from here.
//
// WHY A FRAME'S TEXT IS NOT SIMPLY `callsTo(calls, "fillText")`. Two reasons, and
// a suite that ignored either would grade a build's layout choices rather than
// its reads.
//
//  1. A BUILD DRAWS UNDER ITS OWN TRANSFORM. `specs/overview.md` fixes the three
//     regions in the stage's logical units and says nothing about how a build
//     gets its pen there, so a bar drawn at a translated origin has to read the
//     same as one drawn in stage coordinates. Every anchor below is therefore
//     mapped through the transform in force at the call, and a check asks for the
//     text of a REGION rather than for the arguments of a call.
//  2. A BUILD IS FREE TO LETTER-SPACE. A label drawn one character at a time is
//     six `fillText` calls and the word `PAUSED` appears in none of them. So the
//     draws of a baseline are joined back into the line they read as: two single
//     characters close together are one word, and anything else is separated —
//     which is also what stops two neighbouring FIGURES from reading as one long
//     number.
//
// WHY NOT THE PACKAGE'S `textDraws` AND `imageDraws`. Both are different readings
// of the same frame, not older spellings of these. The package's text draw carries
// a MEASURED extent and no place in the frame; this one carries the operation's
// INDEX and no extent, and `yard-drawing/waypoint-numbers-on-top` decides its point
// by comparing that index against `order.ts`'s. The package's image draw identifies
// the BITMAP that was blitted, which needs the recorder's image interning; this one
// answers only where a blit LANDED, which is what every point here asks. See the
// README's collision table.

/* -------------------------------------------------------------------------- */
/* Regions                                                                    */
/* -------------------------------------------------------------------------- */

/** A rectangle on the `1280 x 720` stage, as a half-open extent. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The status bar (`specs/overview.md`). */
export const BAR: Region = { x0: 0, y0: 0, x1: STAGE_W, y1: BAR_H };

/** The build panel (`specs/overview.md`). */
export const PANEL: Region = {
  x0: PANEL_X,
  y0: BAR_H,
  x1: PANEL_X + PANEL_W,
  y1: STAGE_H,
};

/** The yard (`specs/overview.md`). */
export const YARD: Region = {
  x0: BOARD_X,
  y0: BOARD_Y,
  x1: BOARD_X + BOARD_W,
  y1: BOARD_Y + BOARD_H,
};

/** A point falls inside a region. */
export function inRegion(region: Region, x: number, y: number): boolean {
  return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** One `fillText` or `strokeText`, with its anchor mapped onto the stage. */
export interface TextDraw {
  text: string;
  x: number;
  y: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/** One operation of a frame, with the transform that was in force at it. */
interface Placed {
  call: { method: string; args: unknown[] };
  matrix: Matrix;
  index: number;
}

/**
 * Every call of a frame, each paired with the transform in force when it ran.
 *
 * The transform is tracked rather than assumed, because a build is free to draw
 * its yard, its bar, and its panel from any origin it likes and the
 * specification fixes only where the result lands. The walk itself is the
 * package's `transformed`, so this file and `yard-drawing/order.ts` cannot drift
 * on what a transform operation does.
 *
 * `index` is the operation's place in the WHOLE call list, property sets
 * included, so it compares directly against the index `order.ts` answers.
 */
function placedCalls(calls: readonly DrawCall[]): Placed[] {
  const placed: Placed[] = [];
  const stack: Matrix[] = [];
  let m: Matrix = IDENTITY;
  calls.forEach((call, index) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    if (method === "save") {
      stack.push(m);
    } else if (method === "restore") {
      m = stack.pop() ?? IDENTITY;
    } else {
      const moved = transformed(m, method, args);
      if (moved !== null) m = moved;
    }
    placed.push({ call: { method, args }, matrix: m, index });
  });
  return placed;
}

/** Every text draw of a frame, each anchored where it actually landed. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    const v = numbers(call.args.slice(1), 2);
    if (typeof text !== "string" || v === null) continue;
    const point = apply(matrix, v[0], v[1]);
    draws.push({ text, x: point.x, y: point.y, index });
  }
  return draws;
}

/** One `drawImage`, with the destination it blitted to mapped onto the stage. */
export interface ImageDraw {
  /** The destination rectangle's bounding box on the stage. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its center, which is where a rotated head lands whatever it was rotated by. */
  cx: number;
  cy: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/**
 * Every image a frame blitted, mapped onto the stage.
 *
 * A `drawImage` carries its destination in the last two or four of its
 * arguments; the three-argument form leaves the size to the image itself, which
 * the recorder cannot see, so that form reports a point rather than a rectangle.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "drawImage") continue;
    const args = call.args;
    const box =
      args.length >= 9
        ? numbers(args.slice(5), 4)
        : args.length >= 5
          ? numbers(args.slice(1), 4)
          : (() => {
              const point = numbers(args.slice(1), 2);
              return point === null
                ? null
                : ([point[0], point[1], 0, 0] as [
                    number,
                    number,
                    number,
                    number,
                  ]);
            })();
    if (box === null) continue;
    const [dx, dy, dw, dh] = box;
    const corners = [
      apply(matrix, dx, dy),
      apply(matrix, dx + dw, dy),
      apply(matrix, dx, dy + dh),
      apply(matrix, dx + dw, dy + dh),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const center = apply(matrix, dx + dw / 2, dy + dh / 2);
    draws.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      cx: center.x,
      cy: center.y,
      index,
    });
  }
  return draws;
}

/** How far apart two draws may sit and still read as one letter-spaced word. */
const LETTER_GAP = 24;

/** How far apart two baselines may sit and still read as one line. */
const LINE_GAP = 3;

/**
 * The lines a region's text reads as, top to bottom.
 *
 * Draws sharing a baseline are one line, ordered left to right, and two of them
 * are run together only when both are single characters set close enough to be
 * letter spacing. Everything else is separated by a space, so `473` beside `17`
 * never reads as `47317`.
 */
export function textLines(
  calls: readonly DrawCall[],
  region: Region,
): string[] {
  const draws = textDraws(calls)
    .filter((d) => inRegion(region, d.x, d.y))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: string[] = [];
  let baseline: number | null = null;
  let row: TextDraw[] = [];
  const close = (): void => {
    if (row.length === 0) return;
    const ordered = [...row].sort((a, b) => a.x - b.x);
    let line = "";
    let previous: TextDraw | null = null;
    for (const draw of ordered) {
      if (previous !== null) {
        const spaced =
          previous.text.length <= 1 &&
          draw.text.length <= 1 &&
          draw.x - previous.x < LETTER_GAP;
        if (!spaced) line += " ";
      }
      line += draw.text;
      previous = draw;
    }
    lines.push(line);
    row = [];
  };
  for (const draw of draws) {
    if (baseline === null || Math.abs(draw.y - baseline) > LINE_GAP) {
      close();
      baseline = draw.y;
    }
    row.push(draw);
  }
  close();
  return lines;
}

/** Every line of a region, joined, as one reading. */
export function textIn(calls: readonly DrawCall[], region: Region): string {
  return textLines(calls, region).join("\n");
}

/**
 * One reading of a piece of text: its letters and its digits, and nothing else.
 *
 * Case, spacing, and punctuation all come off, on both sides of a comparison,
 * because a build is free to letter-space a label, to wrap a long line, and to
 * set `Arc-Node` as `ARC NODE`. What the specification fixes is the words.
 */
function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** A region's text carries `needle`, read that way. */
export function drew(
  calls: readonly DrawCall[],
  region: Region,
  needle: string,
): boolean {
  return normalize(textLines(calls, region).join(" ")).includes(
    normalize(needle),
  );
}

/**
 * The separators a build may set between the digit triples of a figure.
 *
 * The specification fixes the figure and leaves its presentation to the build,
 * and grouping is what `Number.prototype.toLocaleString()` does by default —
 * with whichever separator the locale uses: a comma, an apostrophe, a no-break
 * space, a narrow no-break space, a thin space. `1,234` therefore reads as the
 * one figure `1234` rather than as `1` beside `234`, and a build that draws
 * `1234` and one that draws `1,234` are read the same.
 *
 * The ASCII space is deliberately absent from the class. {@link textLines} joins
 * the separate draws of a row with one, so accepting it would read the two
 * figures of `40 130` as the single `40130`. `.` is absent for a related reason:
 * it is the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** The same separators again, to take back off a figure once it is matched. */
const GROUPS = new RegExp(GROUP, "g");

/** One figure a line draws: a grouped one, or a plain one. */
const FIGURE = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every number a region's text draws, in reading order. */
export function figures(calls: readonly DrawCall[], region: Region): number[] {
  const found: number[] = [];
  for (const line of textLines(calls, region)) {
    for (const match of line.matchAll(FIGURE)) {
      found.push(Number(match[0].replace(GROUPS, "")));
    }
  }
  return found;
}

/**
 * The figure a region draws for `value`, or a failure naming what it drew.
 *
 * `tolerance` is the room a build has to round: `specs/pathing.md` reports a
 * route length in tiles as a real number, so a bar that draws `168` for `168.4`
 * has drawn the figure.
 */
export function drawnFigure(
  calls: readonly DrawCall[],
  region: Region,
  value: number,
  what: string,
  tolerance = 0.5,
): number {
  const drawn = figures(calls, region);
  const near = drawn
    .filter((f) => Math.abs(f - value) <= tolerance)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  if (near.length === 0) {
    fail(
      `${what} drawn as ${value}${tolerance === 0 ? "" : ` (± ${tolerance})`}`,
      drawn,
    );
  }
  return near[0]!;
}

/* -------------------------------------------------------------------------- */
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

/** A lattice of logical points inside a rectangle, `step` units apart. */
export function lattice(rect: Rect, step = 2): Point[] {
  const points: Point[] = [];
  for (let y = rect.y + step / 2; y < rect.y + rect.h; y += step) {
    for (let x = rect.x + step / 2; x < rect.x + rect.w; x += step) {
      points.push({ x, y });
    }
  }
  return points;
}

/** The straight-line distance between two colours, ignoring alpha. */
export function rgbDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The furthest apart any one of two samplings of the same points reads. */
export function maxDistance(
  before: readonly Pixel[],
  after: readonly Pixel[],
): number {
  let worst = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    worst = Math.max(worst, rgbDistance(before[i]!, after[i]!));
  }
  return worst;
}

/**
 * The floor a presence reading clears: below it a sampling cannot tell a drawing
 * from the rounding of eight-bit channels and the antialiasing the host applied.
 * It is not a line about how a mark looks. A wash, a low-alpha tint and an opaque
 * fill are all drawings, and `specs/hud.md` fixes what the yard draws and nothing
 * about how strongly, so anything the build painted clears this.
 */
export const DRAWN = 8;

/**
 * Draw one frame and sample it at every point given.
 *
 * The frame is what makes the reading a reading: the engine clears the canvas and
 * runs the build's own `render` each frame, so what is sampled is the picture the
 * build drew for the state it is in right now. The sampling itself is synchronous
 * under this engine, because the canvas is the harness's own.
 */
export async function sample(
  h: Harness,
  points: readonly Point[],
): Promise<Pixel[]> {
  await h.advance(1);
  return h.pixels(points);
}

/**
 * How far the same points read from themselves over `moments` frames, unchanged.
 *
 * The control a reading that expects NOTHING is held against. Nothing in
 * `specs/hud.md` forbids a build from animating its yard, so "these points did
 * not change" can only ever mean "these points moved no further than they move
 * when nothing at all is asked of them".
 */
export async function idleSpread(
  h: Harness,
  points: readonly Point[],
  moments = 4,
): Promise<number> {
  const first = await sample(h, points);
  let worst = 0;
  for (let i = 1; i < moments; i += 1) {
    worst = Math.max(worst, maxDistance(first, await sample(h, points)));
  }
  return worst;
}
