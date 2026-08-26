/**
 * `createEngine`: the factory the root entry point exposes, and the wiring
 * that assembles the engine.
 *
 * The engine is built over a canvas, wires the subsystems together, and binds
 * one game definition for its lifetime. A game's state lives in the framework
 * objects the engine owns — the game instance, the world currently open, that
 * world's game mode and game state, and the actors in it — so `createEngine`
 * takes no state type parameter, and the engine hands those objects back
 * rather than a value the game returned. `D` is the game's debug surface, the
 * value the instance's `initialize` returns, inferred from the instance class
 * the `game` definition names.
 *
 * The contract this module keeps, stated once:
 *
 * - **Construction performs no loading and runs no game code.** It validates
 *   its arguments — the design size, the WebGL2 context, the layout, the level
 *   registry and `startLevel` — builds the subsystems, and attaches the
 *   engine's own listeners. An engine therefore exists — subscribable, its
 *   clock replaceable — before anything the game does is observable, which is
 *   what lets a caller watch the start level being built.
 * - **`initialize` is the gate.** Reading `world`, `instance`, or `debug`, or
 *   calling `run` or `advance`, before it resolves throws naming the ordering;
 *   a second call resolves to the instance already built; a throw out of the
 *   instance's `initialize`, a level's `load`, or a `beginPlay` rejects it
 *   with the cause; an `initialize` returning `undefined` rejects naming the
 *   debug surface; and no frame runs before it resolves.
 * - **The frame runs the fixed eleven-step order** the Frame concepts page
 *   states: clock, time, canvas sync, controllers, actors + components,
 *   timers, collision, game mode, deferred destroys and the transition,
 *   render + overlay, input-frame close. Steps 4 through 8 belong to the open
 *   world and its collision system; this module owns *when* each happens. A
 *   throw out of a tick under `run` propagates to the host and the loop
 *   schedules the next frame; under `advance` it rejects and the remaining
 *   frames do not run.
 * - **`advance` ticks back to back** with no host callback between them, and
 *   awaits an in-flight transition before the next frame; `frames` must be a
 *   whole, non-negative number or it throws a `RangeError` naming the value.
 * - **`destroy` is idempotent**: close the world (controllers, actors, and
 *   game mode end play), run the instance's `shutdown`, halt the loop, silence
 *   the audio bus, and drop every listener. It resolves any promise `run`
 *   returned; aborting a run's signal halts the loop and leaves the engine
 *   usable.
 *
 * ## The three brackets a frame lives inside
 *
 * Three things wrap a frame and each has a different edge, so they are set out
 * here rather than rediscovered from the code:
 *
 * - **The recorder's frame bracket** opens once the canvas has been synced —
 *   nothing is recorded before then, and the backing store a frame reports is
 *   the one it drew into — and closes after the pipeline has drawn. The
 *   diagnostics overlay is outside it, which is what keeps engine chrome out
 *   of a reviewer's evidence.
 * - **The pipeline's own phase**, opened and closed inside `RenderPipeline`,
 *   is what makes a scene-context call from outside a frame — or a state
 *   setter from a `DrawComponent` — throw naming the rule.
 * - **The frame-time sample** spans everything the frame did, the overlay
 *   included, and is recorded even for a frame that threw: a build failing
 *   every frame is exactly the one whose frame times a reader wants.
 *
 * Everything here mirrors the `engine` API page and the `frame` concepts page
 * under `docs/engines/structured-3d/` — those pages are the specification, and
 * behavior that disagrees with them is wrong.
 */

import type { Actor } from "./actors";
import { AssetLoader, type AssetEventEmitter } from "./assets";
import { AudioBus, type CueEventEmitter } from "./audio";
import {
  domSurface,
  syncCanvas,
  WorldCamera,
  type SurfaceMetrics,
} from "./camera";
import { WallClock, type Clock } from "./clocks";
import { CollisionSystem } from "./collision";
import type { Recording } from "./contract";
import { createOverlaySurface, Diagnostics, SampleWindow } from "./diagnostics";
import { EventBus } from "./events";
import {
  bindGameInstance,
  GameInstance,
  type GameDefinition,
  type GameInstanceClass,
  type InitApi,
} from "./game-instance";
import { InputSystem, TOUCH_LAYOUTS } from "./input";
import type { Viewport } from "./math";
import {
  EngineSceneContext,
  RenderPipeline,
  SceneRenderer,
  type Renderer,
} from "./rendering";
import {
  WorldDriver,
  type EngineEventEmitter,
  type EngineEventMap,
  type EngineEvents,
  type EngineWorld,
  type FrameInfo,
  type LoadApi,
  type World,
} from "./worlds";

/* -------------------------------------------------------------------------- */
/* Options and the engine surface                                             */
/* -------------------------------------------------------------------------- */

/**
 * What `createEngine` is built from. `canvas`, the design size, and the game
 * definition are the four things an engine cannot be assembled without;
 * everything else has a default the browser build takes.
 */
export interface EngineOptions<D = unknown> {
  /** The canvas the engine sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the camera's frustum projects into. Finite and positive. */
  width: number;
  /** The logical design height the camera's frustum projects into. Finite and positive. */
  height: number;
  /** The level registry, the start level, and the game instance class. */
  game: GameDefinition<D>;
  /** A CSS color cleared to before every frame. Absent, the frame clears to transparency. */
  background?: string;
  /** A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. */
  layout?: string;
  /** The clock supplying each frame's delta. Defaults to a {@link WallClock}. */
  clock?: Clock;
  /** Where the engine reads element size and device pixel ratio, and attaches its listeners. */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under. Defaults to `"assets/"`. */
  assetRoot?: string;
}

/** What `run` is given: the signal that halts the loop. */
export interface RunOptions {
  /** Halts the loop when it aborts. Omitted, the loop runs until the engine is destroyed. */
  signal?: AbortSignal;
}

/**
 * The engine a game and a validator both hold.
 *
 * `instance` and `world` are live references rather than copies, so a reader
 * observes the current frame's values, and `world` follows each transition.
 * Reading `instance`, `world`, or `debug` before `initialize` resolves throws,
 * naming the ordering, which keeps a contract violation loud at the point of
 * the mistake.
 */
export interface Engine<D = unknown> {
  /** Subscribe to engine events. Available from construction. */
  readonly events: EngineEvents;
  /** The game instance, live. */
  readonly instance: GameInstance<D>;
  /** The world currently open, live. */
  readonly world: World;
  /** The rendering pipeline: its mode and its collision overlay. */
  readonly renderer: Renderer;
  /** The debug surface the instance's `initialize` returned. */
  readonly debug: D;
  /** Construct the instance, run its `initialize`, open `startLevel`, and resolve to the instance. */
  initialize(): Promise<GameInstance<D>>;
  /** Drive the game off the host's frame callback until the supplied signal aborts. */
  run(options?: RunOptions): Promise<void>;
  /** Tick the clock `frames` times, running a frame for each tick the clock accepts. */
  advance(frames: number): Promise<void>;
  /** Replace the clock. The next frame takes its delta from the new one. */
  setClock(clock: Clock): void;
  /** The frame counter, the accumulated simulated time, and the most recent delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** Whether draw-command recording is currently capturing. */
  recording(): boolean;
  /** Arm the recorder. Capture begins at the next frame. */
  startRecording(): void;
  /** Disarm the recorder and return everything captured since `startRecording`. */
  stopRecording(): Recording;
  /** Close the world, halt the loop, and drop every listener. */
  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* Construction helpers                                                       */
/* -------------------------------------------------------------------------- */

/** The key that toggles the diagnostics overlay: engine chrome, not an action. */
const OVERLAY_TOGGLE_CODE = "Backquote";

/** `true` for a logical design dimension the projection arithmetic can use. */
function isDesignSize(size: number): boolean {
  return Number.isFinite(size) && size > 0;
}

/** Whether this host has a real `requestAnimationFrame` to pump against. */
function hasRaf(): boolean {
  return typeof globalThis.requestAnimationFrame === "function";
}

/**
 * How the engine's loop is wired to its host — injectable so a suite drives
 * ticks by hand instead of racing a real frame callback.
 */
export interface EngineHost {
  /** Schedules the next frame; defaults to `requestAnimationFrame`. */
  raf?: (cb: (t: number) => void) => number;
  /** Cancels a scheduled frame; defaults to `cancelAnimationFrame`. */
  cancel?: (handle: number) => void;
  /** Reads the host clock, for tick stamps and frame-time samples; defaults to `performance.now`. */
  now?: () => number;
}

/**
 * Build an engine over `options.canvas`, bound to `options.game`, and wire its
 * parts together.
 *
 * Synchronous, and it runs no game code. Each construction failure is refused
 * where it happens, because each otherwise presents as a build that runs and
 * draws nothing — the most expensive kind to trace.
 *
 * @throws if the design size is not finite and positive, if the canvas yields
 * no WebGL2 context, if `layout` is outside `TOUCH_LAYOUTS`, if `levels` has
 * no entries, or if `startLevel` names no entry of `levels`.
 */
export function createEngine<D = unknown>(
  options: EngineOptions<D>,
): Engine<D> {
  return assembleEngine(options, {});
}

/**
 * {@link createEngine} with the host loop injectable.
 *
 * The shipped factory above is this one with the real host. A suite that steps
 * frames by hand passes its own `raf`, `cancel`, and `now`, which is what lets
 * the loop be driven and the frame-time samples be made deterministic without
 * racing a real frame callback. The subsystems are not injectable: every one
 * of them runs headless already — the canvas is a WebGL2 context a suite
 * supplies, every measurement goes through {@link SurfaceMetrics}, and the
 * decoders are the package's own — so a fake would only be a second, less
 * accurate engine to keep in step with this one.
 */
export function assembleEngine<D = unknown>(
  options: EngineOptions<D>,
  host: EngineHost = {},
): Engine<D> {
  const { canvas, width, height, game } = options;

  if (!isDesignSize(width) || !isDesignSize(height)) {
    throw new Error(
      `createEngine needs a finite, positive logical design size, got ${width}x${height}`,
    );
  }

  const gl = canvas.getContext("webgl2");
  if (gl === null) {
    throw new Error(
      "createEngine could not get a WebGL2 context from the canvas; the engine renders through it",
    );
  }

  if (options.layout !== undefined && !(options.layout in TOUCH_LAYOUTS)) {
    const known = Object.keys(TOUCH_LAYOUTS)
      .map((name) => `"${name}"`)
      .join(", ");
    throw new Error(
      `createEngine was given a touch layout "${options.layout}" outside TOUCH_LAYOUTS; the layouts are ${known}`,
    );
  }

  const levelNames = Object.keys(game.levels);
  if (levelNames.length === 0) {
    throw new Error(
      "createEngine was given a game definition whose levels has no entries; a game needs at least one level to open",
    );
  }
  if (!levelNames.includes(game.startLevel)) {
    const known = levelNames.map((name) => `"${name}"`).join(", ");
    throw new Error(
      `createEngine was given startLevel "${game.startLevel}", which names no entry of levels; the registered levels are ${known}`,
    );
  }

  // Read once and held: the surface is the engine's only window onto the
  // element, and re-deriving it per frame would let a build be measured
  // through one object and listened to through another.
  const surface: SurfaceMetrics = options.surface ?? domSurface(canvas);
  const target = surface.events();

  // First, so `engine.events` is subscribable the instant the engine exists
  // and no subsystem below can be built holding a reference to a bus that is
  // not the one a caller will subscribe to.
  const bus = new EventBus<EngineEventMap>("structured-3d");
  const emit: EngineEventEmitter = (event, payload) => bus.emit(event, payload);

  const background = options.background ?? null;

  let clock: Clock = options.clock ?? new WallClock();

  const nowFn = host.now ?? ((): number => performance.now());
  // Defaults chosen so a host with no rAF (a plain Node process, a jsdom
  // without a visual pretence) still runs rather than crashing.
  const rafFn =
    host.raf ??
    ((cb: (t: number) => void): number =>
      hasRaf()
        ? globalThis.requestAnimationFrame(cb)
        : (setTimeout(() => cb(nowFn()), 16) as unknown as number));
  const cancelFn =
    host.cancel ??
    ((handle: number): void => {
      if (hasRaf()) globalThis.cancelAnimationFrame(handle);
      else clearTimeout(handle);
    });

  let frameCount = 0;
  let accumulatedMs = 0;
  let lastDeltaMs = 0;

  // Sized once up front, so `viewport()` and the game's own initialization see
  // a real fit rather than a zero one before the first frame runs.
  let viewport = syncCanvas(canvas, width, height, surface);

  /** The fit as a caller owns it — a copy, so holding one observes no later frame. */
  const snapshot = (): Viewport => ({
    width: viewport.width,
    height: viewport.height,
    scale: viewport.scale,
    offsetX: viewport.offsetX,
    offsetY: viewport.offsetY,
  });

  const frameInfo = (): FrameInfo => ({
    count: frameCount,
    timeMs: accumulatedMs,
    lastDeltaMs,
  });

  /* ------------------------------------------------------------------ */
  /* The subsystems                                                      */
  /* ------------------------------------------------------------------ */

  // One scene context and one renderer for the engine's whole life, so the
  // recorder wraps a single seam and the object identity a `DrawComponent`
  // keeps stays the object the pipeline draws through. The envelope is a
  // closure rather than a value because the recorder reads it when it is
  // armed, which is the documented moment the design size and background are
  // fixed at.
  const sceneRenderer = new SceneRenderer(gl);
  const scene = new EngineSceneContext(sceneRenderer, () => ({
    width,
    height,
    background,
  }));
  const pipeline = new RenderPipeline(scene, sceneRenderer);

  const assetEmit: AssetEventEmitter = (event, payload) =>
    bus.emit(event, payload);
  const cueEmit: CueEventEmitter = (event, payload) => bus.emit(event, payload);

  const assets = new AssetLoader({
    ...(options.assetRoot === undefined ? {} : { root: options.assetRoot }),
    emit: assetEmit,
  });
  const input = new InputSystem({
    surface,
    viewport: snapshot,
    // Already validated against the catalogue above, so the registry's own
    // refusal of an unknown name never fires from here.
    ...(options.layout === undefined ? {} : { layout: options.layout }),
  });
  const audio = new AudioBus({
    emit: cueEmit,
    // Frame time rather than wall time, so a cue's `t` lines up with the
    // `frame().timeMs` a check asserts against — and so a cue played from the
    // game's initialization, before any frame has run, carries `t: 0`.
    now: (): number => accumulatedMs,
    // Through the loader, so a file-backed cue obeys the asset root, the path
    // rules, and the `asset:loaded` / `asset:failed` events like any asset,
    // and decodes its PCM WAV with no audio context in sight.
    loadAudio: (path: string): Promise<AudioBuffer> => assets.loadAudio(path),
  });

  /**
   * The asset loaders as a named facade rather than the loader itself.
   *
   * Handing the game the `AssetLoader` would hand it every private the class
   * happens to expose later; naming the six members the `assets` API page
   * specifies is what keeps the surface the documented one.
   */
  const assetsApi: InitApi["assets"] = {
    loadMesh: (path) => assets.loadMesh(path),
    loadTexture: (path) => assets.loadTexture(path),
    loadMaterial: (path) => assets.loadMaterial(path),
    loadAudio: (path) => assets.loadAudio(path),
    load: (path) => assets.load(path),
    resolve: (path) => assets.resolve(path),
  };

  const timings = new SampleWindow();
  const diagnostics = new Diagnostics(timings, () => {
    const world = driver.current();
    if (world === null) return null;
    return {
      level: world.level,
      phase: world.mode.phase,
      actors: world.actors().filter((actor) => actor.alive).length,
    };
  });

  /**
   * The 2D surface the overlay draws on, made once.
   *
   * The rendering canvas yielded a WebGL2 context and therefore yields no 2D
   * one, so the panel needs a surface of its own. `null` is the documented
   * headless answer — Node, where there is no document and no 2D
   * `OffscreenCanvas` — and it makes the overlay inert rather than an error.
   */
  const overlay = createOverlaySurface(canvas);

  /* ------------------------------------------------------------------ */
  /* The world driver                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * The camera and the collision system of the world currently open.
   *
   * Rebuilt per opening, beside the world, because both are world state: a
   * transition returns the camera to its defaults and starts the overlap
   * bookkeeping empty. They are held here rather than read back off the world
   * because the engine needs the two members the `World` type does not carry —
   * the camera's `adopt`, which the pipeline poses a followed camera through,
   * and the collision system's `pass` and `close`.
   */
  let camera: WorldCamera<Actor> | null = null;
  let collision: CollisionSystem | null = null;

  const loadApi: LoadApi = {
    assets: assetsApi,
    audio: { load: (cue, path) => audio.load(cue, path) },
    events: bus,
  };

  // Annotated rather than inferred: `buildDeps` reaches back through `driver`
  // for the world the driver is about to publish, and inference cannot chase
  // that circle.
  const driver: WorldDriver = new WorldDriver({
    levels: game.levels,
    // Forwarded rather than held, because the instance does not exist until
    // `initialize` builds it and the driver is constructed before that.
    instance: {
      worldOpened: (world) => requireInstance().worldOpened(world),
      worldClosing: (world) => requireInstance().worldClosing(world),
    },
    emit,
    loadApi,
    buildDeps: (level, definition, levelOptions) => {
      const worldCamera = new WorldCamera<Actor>(snapshot);
      const worldCollision = new CollisionSystem({
        // Read through the driver rather than captured, because the world does
        // not exist yet: the driver publishes it before any `beginPlay` runs,
        // which is the first moment a query can happen.
        actors: () => driver.current()?.actors() ?? [],
        emit,
      });
      camera = worldCamera;
      collision = worldCollision;
      return {
        level,
        definition,
        options: levelOptions,
        camera: worldCamera,
        collision: worldCollision,
        audio,
        assets: assetsApi,
        events: bus,
        emit,
        registerDiagnostic: (name, source) =>
          diagnostics.registerWorld(name, source),
        createInputReader: () => input.createReader(),
        frame: frameInfo,
        viewport: snapshot,
      };
    },
    dropWorldDiagnostics: () => diagnostics.clearWorldRegistry(),
    closeCollision: () => collision?.close(),
  });

  /* ------------------------------------------------------------------ */
  /* The gate                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The instance and debug surface the game built, or `null` before it has.
   *
   * A box rather than two bare slots, because `debug` may perfectly well *be*
   * `null` — a game with no surface returns exactly that — and "has it been
   * built" must not be answered by inspecting the value.
   */
  let built: { instance: GameInstance<D>; debug: D } | null = null;
  /** `true` from the moment `initialize` resolves: the gate every read checks. */
  let ready = false;
  let starting: Promise<GameInstance<D>> | null = null;
  let destroyed = false;

  /**
   * The instance, for the transition hooks that cannot legitimately run before
   * it exists: the start level opens only after `initialize` built it.
   */
  const requireInstance = (): GameInstance<D> => {
    if (built === null) {
      throw new Error(
        "structured-3d: the game instance was asked for before initialize() built it",
      );
    }
    return built.instance;
  };

  /**
   * The world currently open, for a frame that is entitled to one.
   *
   * Separate from the public getter because it cannot legitimately fail: no
   * frame runs before `initialize` resolves, and its message says "engine bug"
   * rather than blaming a caller who did nothing wrong.
   */
  const frameWorld = (): EngineWorld => {
    const world = driver.current();
    if (world === null) {
      throw new Error(
        "structured-3d: a frame ran before the start level opened",
      );
    }
    return world;
  };

  /** A refusal naming the ordering, for every entry point `initialize` gates. */
  const requireReady = (member: string): void => {
    if (!ready) {
      throw new Error(
        `engine.${member} was reached before initialize() resolved: await engine.initialize() first`,
      );
    }
  };

  /* ------------------------------------------------------------------ */
  /* The frame                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Step 10 and step 11: render the settled world, close the recorder's
   * bracket, draw the diagnostics overlay outside it, and close the input
   * frame.
   *
   * The world is read again here rather than passed in, because a frame that
   * performed a transition renders the world it opened.
   */
  const finishFrame = (deltaMs: number): void => {
    const world = frameWorld();
    const worldCamera = camera;
    if (worldCamera !== null) {
      pipeline.render({
        // The pipeline needs the camera's `adopt`, which `World.camera` does
        // not carry, so the frame hands it the concrete camera beside the
        // world rather than the world itself.
        world: { camera: worldCamera, actors: () => world.actors() },
        viewport,
        surface: { width: canvas.width, height: canvas.height },
        frame: frameInfo(),
        background,
      });
    }
    scene.closeFrame({
      count: frameCount,
      timeMs: accumulatedMs,
      deltaMs,
    });

    // Chrome, on its own surface, after the recorder's bracket has closed, so
    // none of it lands in a recording. Synced whether or not the panel is
    // enabled, so a panel toggled off leaves no ghost behind, and drawn from
    // the identity transform the page specifies.
    if (overlay !== null) {
      overlay.sync(canvas.width, canvas.height);
      const ctx = overlay.context();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      diagnostics.draw(ctx, canvas.width, canvas.height);
    }

    // Last, so an edge armed during this frame was available to every
    // controller that ticked and is gone before the next one: a press is news
    // for exactly one frame.
    input.endFrame();
  };

  /**
   * One frame, already worth `deltaMs`.
   *
   * Synchronous unless a tick requested a level transition, in which case the
   * transition — asynchronous because the incoming level's `load` is — is
   * performed before the frame renders, and the returned promise is what the
   * loop holds the next frame for.
   */
  const runFrame = (deltaMs: number): void | Promise<void> => {
    // Step 2. Time moves first, so everything that runs in the frame reads one
    // clock reading.
    frameCount += 1;
    accumulatedMs += deltaMs;
    lastDeltaMs = deltaMs;

    // Sampled even for a frame that throws — a build failing every frame is
    // exactly the one whose frame times a reader wants — and stamped with the
    // simulated time the frame advanced to.
    const startedMs = nowFn();
    const sample = (): void =>
      timings.record(accumulatedMs, nowFn() - startedMs);

    let deferred = false;
    try {
      // Step 3. The fit is taken before any game code runs, so a tick that
      // converts a point uses the fit this frame renders through.
      viewport = syncCanvas(canvas, width, height, surface);

      // The recorder's bracket opens here, after the sync and before anything
      // draws: nothing is recorded in between, and opening it after the sync
      // is what makes the backing store a frame reports the one it drew into.
      // A `startRecording` from inside a tick therefore finds this frame
      // already open and begins at the next, which is the documented rule.
      scene.openFrame({ width: canvas.width, height: canvas.height });

      const world = frameWorld();
      const dt = deltaMs / 1000;
      // Steps 4 to 6: world time, the controllers, the actors and their
      // components, and the timers — the world's own half of the frame.
      world.simulate(dt);
      // Step 7. A paused world runs no pass, so no pair is reported against a
      // world nothing moved.
      if (!world.paused) collision?.pass();
      // Step 8. The mode decides the match from a settled world.
      world.tickMode(dt);

      // Step 9: the destroys first, so a transition never runs over a
      // half-removed world, then the transition itself.
      world.flushDestroyed();
      const pending = world.takeTransition();
      if (pending === null) {
        finishFrame(deltaMs);
        return;
      }
      deferred = true;
      return driver
        .open(pending.level, pending.options)
        .then(() => finishFrame(deltaMs))
        .finally(sample);
    } finally {
      if (!deferred) sample();
    }
  };

  /** Ask the clock what this tick is worth, and run a frame if it is worth one. */
  const tick = (nowMs: number): void | Promise<void> => {
    const deltaMs = clock.delta(nowMs);
    // Step 1. A declined tick is not a frame: the simulation and the counters
    // are left exactly as they were.
    if (deltaMs === null) return;
    return runFrame(deltaMs);
  };

  /* ------------------------------------------------------------------ */
  /* The loop                                                            */
  /* ------------------------------------------------------------------ */

  let running = false;
  let rafHandle: number | null = null;

  /**
   * The promise every live `run` call shares, and the function that settles
   * it.
   *
   * One promise rather than one per call: a second `run` while the loop is
   * already running is a caller asking to wait for the halt, not to start a
   * second pump, and two pumps over one clock would double every frame.
   */
  let pendingRun: Promise<void> | null = null;
  let settleRun: (() => void) | null = null;

  /**
   * How each watched signal is unwatched again. Emptied on every halt, so it
   * is bounded by the callers currently waiting on a run.
   */
  const unwatch = new Set<() => void>();

  /**
   * The transition the loop is waiting out, or `null`.
   *
   * The loop runs no frame while one is in flight — the pump re-arms without
   * consulting the clock, so a paced clock's grid is not consumed by ticks
   * that cannot become frames — and `advance` awaits it before its next tick.
   */
  let inFlight: Promise<void> | null = null;

  /** Hold the loop until `result` settles, surfacing a rejection to the host. */
  const holdFor = (result: Promise<void>): void => {
    inFlight = result.then(
      () => {
        inFlight = null;
      },
      (error: unknown) => {
        inFlight = null;
        // The frame was running under the host's callback, so its failure
        // belongs to the host: rethrow where an uncaught error goes, rather
        // than swallowing it or freezing the loop.
        queueMicrotask(() => {
          throw error;
        });
      },
    );
  };

  const armFrame = (): void => {
    rafHandle = rafFn(pump);
  };

  /** The pump: one host callback, one tick, then re-arm. */
  const pump = (t: number): void => {
    rafHandle = null;
    if (!running) return;
    if (inFlight !== null) {
      // A level transition is asynchronous, and the loop runs no frame while
      // one is in flight; the canvas keeps the last frame it drew.
      armFrame();
      return;
    }
    // Prefer the host's frame timestamp — it is the time the frame is *for*,
    // and it shares a time base with `performance.now`. Not every host passes
    // one, hence the fall back to reading the clock directly.
    const stamp = Number.isFinite(t) ? t : nowFn();
    try {
      const result = tick(stamp);
      if (result !== undefined) holdFor(result);
    } finally {
      // Re-arm in `finally` so a throw out of a tick surfaces (to
      // `window.onerror`, uncaught, where it is visible) without freezing the
      // game forever on one bad frame. The guards re-check state the frame may
      // have changed — a game may destroy the engine from inside its tick.
      if (running && rafHandle === null) armFrame();
    }
  };

  /** Halt when `signal` aborts, or immediately if it already has. */
  const watch = (signal: AbortSignal): void => {
    if (signal.aborted) {
      halt();
      return;
    }
    const onAbort = (): void => halt();
    signal.addEventListener("abort", onAbort, { once: true });
    unwatch.add(() => signal.removeEventListener("abort", onAbort));
  };

  /**
   * Halt the loop, drop any frame already scheduled, and resolve every
   * waiting `run`. Idempotent, because teardown races the signal it is racing.
   * Aborting a run's signal lands here and leaves the engine usable, which is
   * what makes it a separate act from `destroy`.
   */
  const halt = (): void => {
    running = false;
    if (rafHandle !== null) {
      cancelFn(rafHandle);
      rafHandle = null;
    }
    for (const remove of unwatch) remove();
    unwatch.clear();
    const settle = settleRun;
    settleRun = null;
    pendingRun = null;
    settle?.();
  };

  /* ------------------------------------------------------------------ */
  /* Initialization                                                      */
  /* ------------------------------------------------------------------ */

  const initApi: InitApi = {
    input: {
      register: (name, binding): void => input.register(name, binding),
      layout: () => input.layout(),
    },
    audio: {
      define: (cue, spec): void => audio.define(cue, spec),
      load: (cue, path): Promise<void> => audio.load(cue, path),
    },
    assets: assetsApi,
    diagnostics: {
      register: (name, source): void =>
        diagnostics.registerInstance(name, source),
    },
    events: bus,
    viewport: snapshot,
  };

  /* ------------------------------------------------------------------ */
  /* The engine's own listeners                                          */
  /* ------------------------------------------------------------------ */

  const onOverlayKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    // An auto-repeat would strobe the panel for as long as the key is held.
    if (key.code !== OVERLAY_TOGGLE_CODE || key.repeat) return;
    diagnostics.toggle();
  };
  target.addEventListener("keydown", onOverlayKey);

  /**
   * Browsers refuse to start audio outside a user gesture, so the bus stays
   * locked until the player touches something. Listening in the capture phase
   * means a game that consumes its own canvas events cannot accidentally
   * prevent the unlock, and both listeners come off as soon as either fires —
   * one gesture is all that is needed, and the bus's own unlock is idempotent
   * regardless.
   */
  const unlockAudio = (): void => {
    audio.unlock();
    removeUnlockListeners();
  };
  const removeUnlockListeners = (): void => {
    target.removeEventListener("pointerdown", unlockAudio, true);
    target.removeEventListener("keydown", unlockAudio, true);
  };
  target.addEventListener("pointerdown", unlockAudio, true);
  target.addEventListener("keydown", unlockAudio, true);

  /* ------------------------------------------------------------------ */
  /* The engine                                                          */
  /* ------------------------------------------------------------------ */

  const engine: Engine<D> = {
    events: bus,

    /** The game instance, live, once `initialize` resolves. */
    get instance(): GameInstance<D> {
      requireReady("instance");
      return requireInstance();
    },

    /**
     * The world currently open, live: it follows each transition, so a caller
     * that holds the reference across one reads the world that replaced it.
     */
    get world(): World {
      requireReady("world");
      return frameWorld();
    },

    renderer: pipeline,

    /**
     * The value the instance's `initialize` returned, unchanged. The engine
     * reads no member of it, and a game with no surface put `null` here.
     */
    get debug(): D {
      requireReady("debug");
      return (built as { instance: GameInstance<D>; debug: D }).debug;
    },

    /**
     * Construct the game instance, run its `initialize`, open `startLevel`,
     * and resolve to the instance.
     *
     * Every call after the first hands back the *same* promise, which is what
     * makes a second call resolve to the instance already built — and what
     * stops a caller that cannot easily tell whether initialization has
     * happened from running the game's declarations twice, registering every
     * action and cue a second time. A rejection is shared for the same reason:
     * re-running an `initialize` that failed halfway would re-declare whatever
     * it managed to declare before it did.
     */
    initialize(): Promise<GameInstance<D>> {
      starting ??= (async (): Promise<GameInstance<D>> => {
        const InstanceClass =
          game.instance ?? (GameInstance as GameInstanceClass<D>);
        const instance = new InstanceClass();
        // `engine` and `events` are declared readonly on the class and
        // assigned exactly once, here, before any line of game code runs.
        bindGameInstance(instance, engine, bus);
        const returned = await instance.initialize(initApi);
        // The shape is checked here rather than trusted to the type, because a
        // game reaches the engine as a built module the type system has not
        // seen: `undefined` held as the debug surface would read as "the
        // engine lost it" on an unrelated later line.
        if ((returned as unknown) === undefined) {
          throw new Error(
            "the game instance's initialize returned undefined instead of a debug surface; a game with no surface returns null",
          );
        }
        built = { instance, debug: returned };
        // A destroy that raced the awaits above wins: the engine is torn down,
        // and opening the start level into it would resurrect a world nothing
        // will ever close.
        if (destroyed) return instance;
        await driver.open(game.startLevel, {});
        ready = true;
        return instance;
      })();
      return starting;
    },

    /**
     * Drive frames off the host's frame callback until the supplied signal
     * aborts or the engine is destroyed.
     *
     * A destroyed engine has already halted, so this resolves rather than
     * starting a pump nothing would ever stop: `destroy` and `run` race in
     * exactly the teardown paths that are hardest to order, and a refusal
     * there would turn a benign race into a failure.
     */
    run(runOptions: RunOptions = {}): Promise<void> {
      requireReady("run");
      if (destroyed) return Promise.resolve();
      const promise =
        pendingRun ??
        new Promise<void>((resolve) => {
          settleRun = resolve;
        });
      pendingRun = promise;
      if (!running) {
        running = true;
        armFrame();
      }
      // Watched *after* arming, so a signal that has already aborted halts the
      // loop it just started rather than leaving a pump running behind a
      // resolved promise.
      if (runOptions.signal) watch(runOptions.signal);
      return promise;
    },

    /**
     * Tick the clock `frames` times, back to back, running a frame for each
     * tick the clock accepts.
     *
     * No host callback runs in between, so the elapsed real time has no effect
     * on the result and there is nothing to wait for or poll. The one thing
     * awaited is a level transition a frame requested, which completes before
     * the next frame begins, so the frames this runs are frames of a settled
     * world.
     *
     * Two kinds of failure are kept apart deliberately. A caller's own
     * mistake — initialization not awaited, a count that is not a whole
     * non-negative number — throws at the call, where the mistake is. A throw
     * out of the game's own ticks *rejects*, because the frames were running
     * by then; the remaining frames are abandoned, since a caller stepping an
     * exact count needs the failure rather than the frames after it.
     */
    advance(frames: number): Promise<void> {
      requireReady("advance");
      if (!Number.isInteger(frames) || frames < 0) {
        throw new RangeError(
          `engine.advance() needs a whole, non-negative frame count, got ${frames}`,
        );
      }
      if (destroyed) return Promise.resolve();
      return (async (): Promise<void> => {
        for (let i = 0; i < frames; i += 1) {
          if (destroyed) return;
          // A transition the pump left in flight, or one the previous step
          // opened: the next frame is a frame of a settled world.
          if (inFlight !== null) await inFlight;
          const result = tick(nowFn());
          if (result !== undefined) await result;
        }
      })();
    },

    /**
     * Replace the clock in place. The next frame takes its delta from the new
     * one, and the counters carry over deliberately: the frame count and the
     * accumulated time describe the run, not the clock, and resetting them on
     * a swap would make "how far has this game got" depend on how many times
     * the driver changed its mind.
     */
    setClock(next: Clock): void {
      clock = next;
    },

    frame: frameInfo,

    viewport: snapshot,

    recording: (): boolean => scene.recording(),

    /**
     * Arm the recorder, so the frames from here on are captured.
     *
     * Capture begins at the next frame rather than part-way through the
     * current one: a recorder armed from inside a tick would otherwise open a
     * frame whose renderer-state sets had already happened. A second call
     * while already recording is refused rather than silently discarding what
     * has been captured — the mistake is always an unbalanced
     * `stopRecording`, and a caller told about it loses nothing.
     */
    startRecording(): void {
      scene.startRecording();
    },

    /**
     * Disarm the recorder and hand back what it captured.
     *
     * Refuses when nothing is being recorded, for the same reason
     * `startRecording` refuses a second arming: an empty recording returned
     * from an unbalanced call reads as "the build drew nothing", which is a
     * claim about the build rather than about the caller.
     */
    stopRecording(): Recording {
      return scene.stopRecording();
    },

    /**
     * Close the world, run the instance's `shutdown`, halt the loop, and drop
     * every listener.
     *
     * Idempotent, because teardown races: a page unload, an explicit call, and
     * a test's `afterEach` all reach here, and only the first one has anything
     * to do. The loop is halted first so no frame runs into a world that is
     * closing, the audio bus is silenced so a looping cue does not outlive the
     * engine that started it, the overlay surface is taken out of the document
     * it was put in, and the subscriptions go last: a handler typically closes
     * over the caller's own scene, and leaving the bus subscribed after
     * teardown keeps that scope alive.
     */
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      halt();
      if (ready) driver.close();
      if (built !== null) built.instance.shutdown();
      audio.silence();
      input.detach();
      target.removeEventListener("keydown", onOverlayKey);
      removeUnlockListeners();
      overlay?.dispose();
      bus.clear();
    },
  };

  return engine;
}
