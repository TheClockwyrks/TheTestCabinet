/**
 * `createEngine`: the factory the root entry point exposes, and the wiring that
 * assembles the engine.
 *
 * The engine is built over a canvas, wires the subsystems together, and binds
 * one game definition for its lifetime. A game's state lives in the framework
 * objects the engine owns — the game instance, the world currently open, that
 * world's game mode and game state, and the actors in it — so `createEngine`
 * takes no state type parameter, and the engine hands those objects back rather
 * than a value the game returned. `D` is the game's debug surface, the value the
 * instance's `initialize` returns, inferred from the instance class the `game`
 * definition names.
 *
 * The contract this module keeps, stated once:
 *
 * - **Construction performs no loading and runs no game code.** It validates
 *   its arguments — the design size, the `webgl2` context, the screen layer's
 *   canvas, the layout, the level registry and `startLevel` — builds the
 *   subsystems, and attaches the engine's own listeners. An engine therefore
 *   exists — subscribable, its clock replaceable, its `scene` readable — before
 *   anything the game does is observable, which is what lets a caller watch the
 *   start level being built.
 * - **`initialize` is the gate.** Reading `world`, `instance`, or `debug`, or
 *   calling `run` or `advance`, before it resolves throws naming the ordering;
 *   a second call resolves to the instance already built; a throw out of the
 *   instance's `initialize`, a level's `load`, or a `beginPlay` rejects it with
 *   the cause; an `initialize` returning `undefined` rejects naming the debug
 *   surface; and no frame runs before it resolves.
 * - **The frame runs the fixed eleven-step order** the Frame concepts page
 *   states: clock, time, canvas sync, controllers, actors + components, timers,
 *   collision, game mode, deferred destroys and the transition, the render
 *   (camera, scene sync, world pass, overlay, screen pass, capture, diagnostics,
 *   composite), input-frame close. A throw out of a tick under `run` propagates
 *   to the host and the loop schedules the next frame; under `advance` it
 *   rejects and the remaining frames do not run.
 * - **`advance` ticks back to back** with no host callback between them, and
 *   awaits an in-flight transition before the next frame; `frames` must be a
 *   whole, non-negative number or it throws a `RangeError` naming the value.
 * - **`destroy` is idempotent**: close the world (controllers, actors, and game
 *   mode end play), run the instance's `shutdown`, halt the loop, silence the
 *   audio bus, discard an armed capture, dispose the renderer, and drop every
 *   listener. It resolves any promise `run` returned; aborting a run's signal
 *   halts the loop and leaves the engine usable.
 *
 * ## How the engine reaches the other subsystems
 *
 * The engine drives its collaborators through the narrow ports declared below
 * ({@link EngineSubsystems}), built by a factory it is handed. `createEngine`
 * wires {@link defaultSubsystems}, which constructs the real subsystem classes;
 * {@link assembleEngine} is the same factory with the ports injectable, which is
 * how the engine's own suite drives a frame against fakes, and where an
 * integrator re-points a port whose construction needs collaborators this module
 * cannot know about.
 *
 * The render pipeline is the one collaborator built here rather than by the
 * factory. It owns the two canvases, and three of the five construction
 * refusals are its — so building it first is what makes the errors table's order
 * hold however the rest is wired, and what lets `engine.scene` and
 * `engine.renderer` be readable from construction.
 *
 * The frame steps that belong to the worlds subsystem — the controller, actor,
 * timer, collision and game-mode ticks, the deferred destroy flush, and the
 * level-transition sequence — are reached through one seam,
 * {@link WorldDriver}. The engine decides *when* each step happens and the
 * driver decides *what* it does, which keeps the eleven-step order in exactly
 * one place without this module reaching into the worlds module's internals.
 */

import type * as THREE from "three";

import {
  AssetLoader,
  type AssetApi,
  type AssetEventEmitter,
  type AssetEventMap,
} from "./assets";
import { AudioBus, type CueEventEmitter } from "./audio";
import { domSurface, syncCanvas, WorldCamera } from "./camera";
import { WallClock } from "./clocks";
import { CollisionSystem } from "./collision";
import type {
  ActionBinding,
  CameraSnapshot,
  Clock,
  CueSpec,
  DiagnosticReading,
  DiagnosticValue,
  FrameInfo,
  InputReader,
  Recording,
  Renderer,
  RunOptions,
  SurfaceMetrics,
  TouchLayout,
  Viewport,
  WorldAudio,
} from "./contract";
import { Diagnostics, rendererCounts } from "./diagnostics";
import type { EngineEventEmitter, EngineEvents } from "./events";
import { EngineEventBus } from "./events";
import {
  bindGameInstance,
  GameInstance,
  type GameDefinition,
  type GameInstanceClass,
  type InitApi,
} from "./game-instance";
import { InputSystem, TOUCH_LAYOUTS } from "./input";
import { FrameRecorder } from "./recording";
import { RenderPipeline, type RenderCounts } from "./rendering";
import { EngineWorld, type LoadApi, type World } from "./worlds";

/** The key that toggles the diagnostics overlay: engine chrome, not an action. */
const OVERLAY_TOGGLE_CODE = "Backquote";

/** Whether this host has a real `requestAnimationFrame` to pump against. */
function hasRaf(): boolean {
  return typeof globalThis.requestAnimationFrame === "function";
}

/* -------------------------------------------------------------------------- */
/* The documented surface                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What an engine is built with.
 *
 * The canvas, the logical design size, and the game definition are required;
 * everything else has a default that makes a plain build work. The two optional
 * seams — `surface` and `clock` — are what let a validator run the same engine
 * over a canvas with no document behind it and step it frame by frame.
 *
 * These live here rather than in `contract.ts` because `game` names a
 * {@link GameDefinition}, which names the framework classes; the contract module
 * is deliberately a leaf whose only import is `three`.
 */
export interface EngineOptions<D = unknown> {
  /** The stage canvas the engine sizes, clears, and renders the scene through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the camera projects into. Finite and positive. */
  width: number;
  /** The logical design height the camera projects into. Finite and positive. */
  height: number;
  /** The level registry, the start level, and the game instance class. */
  game: GameDefinition<D>;
  /**
   * A CSS color the whole canvas is cleared to before every frame, letterbox
   * bars included. Absent, the frame clears to transparency.
   */
  background?: string;
  /**
   * Whether an image the fit scales on the screen layer is resampled
   * bilinearly; `false` samples nearest-neighbor, which keeps pixel art crisp.
   */
  imageSmoothing?: boolean;
  /** A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game registers. */
  layout?: string;
  /** The clock supplying each frame's delta; defaults to a {@link WallClock}. */
  clock?: Clock;
  /**
   * Where the engine reads element size and device pixel ratio, and attaches
   * its key and pointer listeners; defaults to reading the canvas itself.
   */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under; defaults to `"assets/"`. */
  assetRoot?: string;
  /**
   * The 2D canvas the screen layer draws on; defaults to one created from the
   * stage canvas's owning document.
   */
  screen?: HTMLCanvasElement;
  /**
   * `true` enables shadow maps with soft (PCF) filtering, so a light declared
   * with `castShadow` shadows a mesh declared with `receiveShadow`.
   */
  shadows?: boolean;
}

/**
 * The engine a caller drives, and the framework objects it hands back.
 *
 * `instance` and `world` are live references rather than copies, so a reader
 * observes the current frame's values, and `world` follows each transition —
 * which is what lets a validator hold the reference across one and read the
 * world that replaced it.
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
  /**
   * The `THREE.Scene` the pipeline maintains, live. Available from
   * construction. The pipeline writes it; a caller reads it.
   */
  readonly scene: THREE.Scene;
  /** The debug surface the instance's `initialize` returned. */
  readonly debug: D;
  /**
   * Construct the game instance, run its `initialize`, open `startLevel`, and
   * resolve to the instance.
   */
  initialize(): Promise<GameInstance<D>>;
  /** Drive the game off the host's frame callback until the signal aborts. */
  run(options?: RunOptions): Promise<void>;
  /** Tick the clock `frames` times, running a frame for each tick it accepts. */
  advance(frames: number): Promise<void>;
  /** Replace the clock. The next frame takes its delta from the new one. */
  setClock(clock: Clock): void;
  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /**
   * Every registered diagnostic source and what it reports now, the instance
   * registry's first and then the world's.
   */
  diagnostics(): readonly DiagnosticReading[];
  /** Whether the recorder is capturing frames. */
  recording(): boolean;
  /** Arm the recorder. Capture begins at the next frame. */
  startRecording(): void;
  /** Disarm the recorder, flush the encoder, and resolve with what it caught. */
  stopRecording(): Promise<Recording>;
  /**
   * Close the world, halt the loop, drop every listener, discard an armed
   * capture, and dispose the renderer. Idempotent.
   */
  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* The ports the engine drives its collaborators through                      */
/* -------------------------------------------------------------------------- */

/** A transition a frame requested, as the driver hands it to the engine. */
export interface PendingTransition {
  /** The level to open. */
  level: string;
  /** What `world.open` was given, reaching the incoming mode as `options`. */
  options: Readonly<Record<string, unknown>> | undefined;
}

/**
 * The seam the engine drives the worlds subsystem through.
 *
 * The engine owns *when* each frame step happens; the driver owns *what* each
 * one does — the whole of the framework bookkeeping the Worlds pages assign to
 * the worlds module. One method per frame step the engine schedules:
 *
 * - {@link WorldDriver.open} runs the full twelve-step transition sequence the
 *   Worlds API page fixes (for the initial open, with no outgoing world):
 *   `world:opening`, the outgoing close steps, the incoming `load` awaited,
 *   construction, the `beginPlay`s in order, `world:opened`, and
 *   `instance.worldOpened`.
 * - {@link WorldDriver.tick} is frame steps 2 and 4–8: advance `world.time`,
 *   then the controllers, the actors and their components, the timers, the
 *   collision pass, and the game mode, honoring the pause rules.
 * - {@link WorldDriver.flushDestroyed} is step 9's first half: destroyed actors
 *   end play and leave the world.
 * - {@link WorldDriver.takeTransition} hands over (and clears) the transition a
 *   tick requested through `world.open`, which the engine then performs before
 *   the frame renders and awaits before the next frame.
 * - {@link WorldDriver.close} ends play for the open world without opening
 *   another, for `engine.destroy`.
 */
export interface WorldDriver {
  /** The world currently open, or `null` before the start level opens. */
  world(): World | null;
  /** Open `level`, running the full transition sequence. */
  open(
    level: string,
    options: Readonly<Record<string, unknown>> | undefined,
  ): Promise<void>;
  /** Advance world time and run the frame's simulation ticks, `dt` in seconds. */
  tick(dtSeconds: number): void;
  /** End play for, and remove, every actor destroyed this frame. */
  flushDestroyed(): void;
  /** The transition this frame requested, or `null`. Reading clears it. */
  takeTransition(): PendingTransition | null;
  /** Close the open world (everything ends play with `"level-closed"`). */
  close(): void;
}

/** The slice of the input subsystem the engine itself drives. */
export interface InputPort {
  /** `InitApi.input.register`, forwarded. */
  register(name: string, binding: ActionBinding): void;
  /** `InitApi.input.layout`, forwarded. */
  layout(): TouchLayout | null;
  /** Closes the input frame; called last in every frame. */
  endFrame(): void;
  /** Removes every listener; called from `engine.destroy`. */
  detach(): void;
}

/** The slice of the audio subsystem the engine itself drives. */
export interface AudioPort {
  /** `InitApi.audio.define`, forwarded. */
  define(cue: string, spec: CueSpec): void;
  /** `InitApi.audio.load`, forwarded. */
  load(cue: string, path: string): Promise<void>;
  /**
   * Places the listener at the camera. Called every frame, once the camera has
   * been brought up to date and before the picture is drawn, so what a player
   * hears is placed against what the camera sees.
   */
  listen(camera: CameraSnapshot): void;
  /** Opens the audio context; called on the first pointer or key event. */
  unlock(): void;
  /** Stops every running loop, announcing nothing; called from `destroy`. */
  silence(): void;
}

/** The slice of the diagnostics subsystem the engine itself drives. */
export interface DiagnosticsPort {
  /** `InitApi.diagnostics.register`, forwarded to the instance registry. */
  registerInstance(name: string, source: () => DiagnosticValue): void;
  /** Every source in both registries and what each reports now. */
  read(): readonly DiagnosticReading[];
  /** Inverts the overlay; bound to the `Backquote` key by the engine. */
  toggle(): void;
  /**
   * Draws the overlay on the screen layer in device pixels, after the recorder
   * has taken the frame and before the layer is composited.
   */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  /** Records what one frame's work cost, stamped with simulated time. */
  recordFrame(atMs: number, costMs: number): void;
}

/** Every collaborator the engine drives, behind the ports above. */
export interface EngineSubsystems {
  input: InputPort;
  audio: AudioPort;
  diagnostics: DiagnosticsPort;
  /** The asset loaders, as `InitApi.assets` and `world.assets` expose them. */
  assets: AssetApi;
  worlds: WorldDriver;
}

/**
 * What the engine hands a subsystems factory: everything a subsystem needs from
 * the engine, closed over live state so a subsystem built before the first frame
 * reads the frame that is current when it asks.
 */
export interface EngineServices {
  /** The engine's broadcaster — `on` for a subscriber, `emit` for a subsystem. */
  readonly events: EngineEventBus;
  /** The stage canvas the engine renders the world pass through. */
  readonly canvas: HTMLCanvasElement;
  /** The screen layer's 2D context, which the diagnostics overlay draws on. */
  readonly screen: CanvasRenderingContext2D;
  /** Where the engine reads element size and attaches its listeners. */
  readonly surface: SurfaceMetrics;
  /** The game definition the engine is bound to. */
  readonly game: GameDefinition<unknown>;
  /** The logical design width. */
  readonly width: number;
  /** The logical design height. */
  readonly height: number;
  /** The asset root, exactly as the options carried it. */
  readonly assetRoot: string | undefined;
  /** The layout name, exactly as the options carried it (already validated). */
  readonly layout: string | undefined;
  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** The scene render's cost for the frame most recently drawn. */
  counts(): RenderCounts;
  /** The game instance, once `initialize` has built it. */
  instance(): GameInstance<unknown>;
}

/** Builds the engine's collaborators; {@link defaultSubsystems} is the real one. */
export type SubsystemsFactory = (services: EngineServices) => EngineSubsystems;

/**
 * How the engine's loop is wired to its host — injectable so the suite drives
 * ticks by hand instead of racing a real frame callback.
 */
export interface EngineHost {
  /** Schedules the next frame; defaults to `requestAnimationFrame`. */
  raf?: (cb: (t: number) => void) => number;
  /** Cancels a scheduled frame; defaults to `cancelAnimationFrame`. */
  cancel?: (handle: number) => void;
  /** Reads the host clock, for tick stamps; defaults to `performance.now`. */
  now?: () => number;
}

/* -------------------------------------------------------------------------- */
/* The shipped wiring                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One memoized audio context, shared by decode and playback.
 *
 * The asset loader decodes a produced sound file through a context, and the
 * audio bus plays the resulting buffer through one; sharing one context keeps a
 * file-backed cue's buffer and the destination it plays into in the same world.
 * Which of them asks first is not fixed — decoding happens during the game's
 * initialization, the unlock on the player's first gesture — so the factory
 * memoizes rather than the caller. A host with no Web Audio yields `null` and is
 * asked again next time, so a context that only appears later is still picked
 * up.
 */
function sharedAudioContext(): () => AudioContext | null {
  let context: AudioContext | null = null;
  return (): AudioContext | null => {
    if (context !== null) return context;
    const ctor = (globalThis as { AudioContext?: typeof AudioContext })
      .AudioContext;
    context = ctor ? new ctor() : null;
    return context;
  };
}

/** What {@link createWorldDriver} needs from the subsystems beside it. */
interface DriverPorts {
  /** The cue bus, presented to each world as `world.audio`. */
  worldAudio: WorldAudio;
  /** `LoadApi.audio.load`: binds a cue to a fetched, decoded file. */
  audioLoad(cue: string, path: string): Promise<void>;
  /** The asset loaders, as `world.assets` and a `LoadApi` expose them. */
  assets: AssetApi;
  /** A fresh input reader, one per player controller added. */
  createReader(): InputReader;
  /** Registers a source in the diagnostics *world* registry. */
  registerWorldDiagnostic(name: string, source: () => DiagnosticValue): void;
  /** Drops every world-registry source; step 3 of a level closing. */
  dropWorldDiagnostics(): void;
}

/**
 * The shipped {@link WorldDriver}: the transition sequence and the frame's
 * simulation steps, over {@link EngineWorld} and {@link CollisionSystem}.
 *
 * The worlds module owns what each step does — the world's construction, its
 * ticks, its teardown — and this driver owns the fixed sequence the Worlds API
 * page states, because the sequence threads through collaborators only the
 * engine holds: the broadcaster, the game instance, the diagnostics registries,
 * and the level registry.
 */
function createWorldDriver(
  services: EngineServices,
  ports: DriverPorts,
): WorldDriver {
  /** The open world and its collision system, or `null` before the first open. */
  let current: { world: EngineWorld; collision: CollisionSystem } | null = null;

  const emit: EngineEventEmitter = (event, payload) =>
    services.events.emit(event, payload);

  return {
    world: (): World | null => current?.world ?? null,

    async open(
      level: string,
      options: Readonly<Record<string, unknown>> | undefined,
    ): Promise<void> {
      const definition = services.game.levels[level];
      if (definition === undefined) {
        const known = Object.keys(services.game.levels)
          .map((name) => `"${name}"`)
          .join(", ");
        throw new Error(
          `world.open("${level}") names no entry of levels; the registered levels are ${known}`,
        );
      }

      // Steps 1–7: announce, let the instance read the outgoing world, drop
      // what the engine holds for it, end its play, and announce the close. The
      // held overlap pairs end before the world's own teardown, so an
      // `overlap:end` handler still reads a whole world.
      emit("world:opening", { from: current?.world.level ?? null, to: level });
      if (current !== null) {
        const closing = current;
        services.instance().worldClosing(closing.world);
        ports.dropWorldDiagnostics();
        closing.collision.close();
        closing.world.close();
        emit("world:closed", { level: closing.world.level });
      }

      // Step 8: the incoming level's `load`, awaited. A throw rejects the
      // transition — and `engine.initialize`, when this is the start level —
      // with the cause.
      const loadApi: LoadApi = {
        assets: ports.assets,
        audio: { load: (cue, path) => ports.audioLoad(cue, path) },
        events: services.events,
      };
      await definition.load?.(loadApi);

      // Step 9: the world is built — the mode with `options`, then the state,
      // then the declared actors, inside `EngineWorld`'s constructor — over a
      // camera and a collision world rebuilt at their defaults. The camera is
      // built at the logical design size, which is what its aspect and its
      // orthographic span are measured in.
      const camera = new WorldCamera(services.width, services.height);
      let world: EngineWorld | undefined;
      const collision = new CollisionSystem({
        actors: () => world?.actors() ?? [],
        emit,
      });
      world = new EngineWorld({
        level,
        definition,
        options: options ?? {},
        camera,
        collision,
        audio: ports.worldAudio,
        assets: ports.assets,
        events: services.events,
        emit,
        registerDiagnostic: ports.registerWorldDiagnostic,
        createInputReader: ports.createReader,
        frame: services.frame,
        viewport: services.viewport,
      });
      // The live reference moves before any `beginPlay` runs, so game code that
      // reaches back through `engine.world` mid-transition reads the world it is
      // being built into.
      current = { world, collision };

      // Steps 10–12: begin play, announce, and let the instance seed it.
      world.begin();
      emit("world:opened", { level });
      services.instance().worldOpened(world);
    },

    tick(dtSeconds: number): void {
      if (current === null) return;
      // Steps 2 and 4–6 (time, controllers, actors, timers), then the collision
      // pass — a paused world runs none — then the mode's tick, so the mode
      // decides the match from a settled world.
      current.world.simulate(dtSeconds);
      if (!current.world.paused) current.collision.pass();
      current.world.tickMode(dtSeconds);
    },

    flushDestroyed(): void {
      current?.world.flushDestroyed();
    },

    takeTransition(): PendingTransition | null {
      return current?.world.takeTransition() ?? null;
    },

    close(): void {
      if (current === null) return;
      const closing = current;
      current = null;
      ports.dropWorldDiagnostics();
      closing.collision.close();
      closing.world.close();
    },
  };
}

/**
 * The engine's collaborators as the shipped package wires them: the real
 * subsystem classes, constructed over the engine's services and each other.
 */
export function defaultSubsystems(services: EngineServices): EngineSubsystems {
  // The loader declares its own two-entry map rather than reaching for the
  // engine's, which keeps it a leaf; the two declare the same payloads under the
  // same keys, so the bridge is a re-dispatch per name rather than a conversion,
  // and each branch's literal event name is what proves the payload to the bus.
  const assetEmit: AssetEventEmitter = (event, payload): void => {
    if (event === "asset:loaded") {
      services.events.emit(
        "asset:loaded",
        payload as AssetEventMap["asset:loaded"],
      );
    } else {
      services.events.emit(
        "asset:failed",
        payload as AssetEventMap["asset:failed"],
      );
    }
  };
  const cueEmit: CueEventEmitter = (event, payload) =>
    services.events.emit(event, payload);
  const audioContext = sharedAudioContext();

  const assets = new AssetLoader({
    root: services.assetRoot,
    emit: assetEmit,
    audioContext,
  });
  const input = new InputSystem({
    surface: services.surface,
    viewport: services.viewport,
    // Already validated against the catalogue by `assembleEngine`, so the
    // registry's own refusal of an unknown name never fires from here.
    ...(services.layout === undefined ? {} : { layout: services.layout }),
  });
  const audio = new AudioBus({
    emit: cueEmit,
    // Frame time rather than wall time, so a cue's `t` lines up with the
    // `frame().timeMs` a check asserts against.
    now: (): number => services.frame().timeMs,
    // Through the loader, so a file-backed cue obeys the asset root, the path
    // rules, and the `asset:loaded` / `asset:failed` events like any asset.
    loadAudio: (path: string): Promise<AudioBuffer> => assets.loadAudio(path),
    audioContext,
  });

  // The overlay's world line reads the driver built two steps below; the
  // indirection is a `let` because each needs the other at construction.
  let worlds: WorldDriver | null = null;
  const diagnostics = new Diagnostics({
    world: () => {
      const world = worlds?.world() ?? null;
      if (world === null) return null;
      return {
        level: world.level,
        phase: world.mode.phase,
        actors: world.actors().length,
      };
    },
    // The scene render's counters, captured the instant the scene was drawn
    // rather than read off `renderer.info` — the frame makes three render calls
    // and three resets, and the figure the panel wants is the game's picture.
    counts: rendererCounts({ counts: services.counts }),
  });

  worlds = createWorldDriver(services, {
    worldAudio: audio,
    audioLoad: (cue, path) => audio.load(cue, path),
    assets,
    createReader: () => input.createReader(),
    registerWorldDiagnostic: (name, source) =>
      diagnostics.registerWorld(name, source),
    dropWorldDiagnostics: () => diagnostics.dropWorldSources(),
  });

  return { input, audio, diagnostics, assets, worlds };
}

/* -------------------------------------------------------------------------- */
/* createEngine                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build an engine over `options.canvas`, bound to `options.game`, and wire its
 * parts together.
 *
 * Synchronous, and it runs no game code. Each construction failure is refused
 * where it happens, because each otherwise presents as a build that runs and
 * draws nothing — the most expensive kind to trace.
 *
 * @throws if the design size is not finite and positive, if the canvas yields no
 * `webgl2` context, if there is no screen canvas to draw the layer on, if
 * `layout` is outside `TOUCH_LAYOUTS`, if `levels` has no entries, or if
 * `startLevel` names no entry of `levels`.
 */
export function createEngine<D = unknown>(
  options: EngineOptions<D>,
): Engine<D> {
  return assembleEngine(options, defaultSubsystems);
}

/**
 * {@link createEngine} with the collaborators and the host loop injectable.
 *
 * The shipped factory above is this one partially applied; the engine's own
 * suite injects fakes over the documented ports, and an integrator re-points a
 * port whose construction this module cannot know.
 */
export function assembleEngine<D = unknown>(
  options: EngineOptions<D>,
  factory: SubsystemsFactory,
  host: EngineHost = {},
): Engine<D> {
  const { canvas, width, height, game } = options;

  // First, and before every other refusal: the pipeline raises the errors
  // table's first three conditions — the design size, the `webgl2` context, the
  // screen canvas — in exactly that order, because the surface everything else
  // is drawn on has to exist before anything measured or drawn against it can
  // be judged. Building it here rather than in the subsystems factory is also
  // what makes `engine.scene` and `engine.renderer` readable from construction.
  const pipeline = new RenderPipeline({
    canvas,
    width,
    height,
    ...(options.background === undefined
      ? {}
      : { background: options.background }),
    ...(options.imageSmoothing === undefined
      ? {}
      : { imageSmoothing: options.imageSmoothing }),
    ...(options.screen === undefined ? {} : { screen: options.screen }),
    ...(options.shadows === undefined ? {} : { shadows: options.shadows }),
  });

  /**
   * Refuse, having first given back the GPU resources the pipeline took.
   *
   * The pipeline is built before the remaining arguments are judged, so a build
   * with a bad layout *and* a good canvas would otherwise strand a live
   * `WebGLRenderer` and its context for every engine it failed to construct — a
   * page that retries construction in a loop runs the browser out of contexts,
   * silently, several engines later.
   */
  const refuse = (message: string): never => {
    pipeline.dispose();
    throw new Error(message);
  };

  if (options.layout !== undefined && !(options.layout in TOUCH_LAYOUTS)) {
    const known = Object.keys(TOUCH_LAYOUTS)
      .map((name) => `"${name}"`)
      .join(", ");
    refuse(
      `createEngine was given a touch layout "${options.layout}" outside TOUCH_LAYOUTS; the layouts are ${known}`,
    );
  }

  const levelNames = Object.keys(game.levels);
  if (levelNames.length === 0) {
    refuse(
      "createEngine was given a game definition whose levels has no entries; a game needs at least one level to open",
    );
  }
  if (!levelNames.includes(game.startLevel)) {
    const known = levelNames.map((name) => `"${name}"`).join(", ");
    refuse(
      `createEngine was given startLevel "${game.startLevel}", which names no entry of levels; the registered levels are ${known}`,
    );
  }

  // Read once and held: the surface is the engine's only window onto the
  // element, and re-deriving it per frame would let a build be measured through
  // one object and listened to through another.
  const surface: SurfaceMetrics = options.surface ?? domSurface(canvas);
  const target = surface.events();

  // First among the engine's own state, so `engine.events` is subscribable the
  // instant the engine exists and no subsystem below can be built holding a
  // reference to a bus that is not the one a caller will subscribe to.
  const bus = new EngineEventBus();

  // The recorder holds both canvases for its whole life, which is what lets a
  // recording span a level transition as one continuous picture: the pipeline
  // keeps drawing on the same two surfaces whatever world is open.
  const recorder = new FrameRecorder(canvas, pipeline.screenCanvas);

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

  // Sized once up front, so `viewport()` and the game's own initialization see a
  // real fit rather than a zero one before the first frame runs.
  let viewport = syncCanvas(canvas, width, height, surface);
  pipeline.syncScreen();

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

  const services: EngineServices = {
    events: bus,
    canvas,
    screen: pipeline.screen,
    surface,
    game: game as GameDefinition<unknown>,
    width,
    height,
    assetRoot: options.assetRoot,
    layout: options.layout,
    frame: frameInfo,
    viewport: snapshot,
    counts: (): RenderCounts => pipeline.counts(),
    instance: (): GameInstance<unknown> => {
      if (built === null) {
        throw new Error(
          "structured-3d: the game instance was asked for before initialize() built it",
        );
      }
      return built.instance as GameInstance<unknown>;
    },
  };

  const subsystems = factory(services);

  /**
   * The world currently open, for a frame that is entitled to one.
   *
   * Separate from the public getter because it cannot legitimately fail: no
   * frame runs before `initialize` resolves, and its message says "engine bug"
   * rather than blaming a caller who did nothing wrong.
   */
  const frameWorld = (): World => {
    const world = subsystems.worlds.world();
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
   * Step 10 and step 11: draw the settled world, then close the input frame.
   *
   * The eight sub-steps of the render run in the order the Frame page fixes,
   * and three of them are the engine's rather than the pipeline's. The
   * listener is placed once the camera has been brought up to date, so what a
   * player hears is placed against what the camera sees. The recorder takes the
   * frame after the screen layer is drawn and before the overlay is, which is
   * what keeps every recording free of engine chrome while holding the render
   * mode, the collision overlay, and a `DrawComponent`'s drawing inside it. And
   * the overlay is given the identity transform first: it is chrome laid over
   * the finished picture rather than part of it, so it is measured and drawn in
   * device pixels rather than being scaled — and letterboxed — along with the
   * game's own coordinates.
   */
  const finishFrame = (deltaMs: number): void => {
    const world = frameWorld();
    // The world's delta, not the frame's: a paused world holds every model's
    // pose where it stood, and this is the number that decides it.
    const worldDt = world.paused ? 0 : deltaMs / 1000;

    pipeline.syncScene(world, worldDt);
    subsystems.audio.listen(world.camera.snapshot());
    pipeline.renderWorld(world, viewport);
    pipeline.renderScreen(world, viewport, frameInfo());
    recorder.capture(frameInfo());
    pipeline.screen.setTransform(1, 0, 0, 1, 0, 0);
    subsystems.diagnostics.draw(pipeline.screen, canvas.width, canvas.height);
    pipeline.composite();
    // Last, so an edge armed during this frame was available to every
    // controller that ticked and is gone before the next one: a press is news
    // for exactly one frame.
    subsystems.input.endFrame();
  };

  /**
   * One frame, already worth `deltaMs`.
   *
   * Synchronous unless a tick requested a level transition, in which case the
   * transition — asynchronous because the incoming level's `load` is — is
   * performed before the frame renders, and the returned promise is what the
   * loop holds the next frame for. The frame that performs the transition
   * renders the world it opened.
   */
  const runFrame = (deltaMs: number): void | Promise<void> => {
    // Time moves first, so everything that runs in the frame reads one clock
    // reading.
    frameCount += 1;
    accumulatedMs += deltaMs;
    lastDeltaMs = deltaMs;

    // Sampled even for a frame that throws — a build failing every frame is
    // exactly the one whose frame times a reader wants — and stamped with the
    // simulated time the frame advanced to.
    const startedMs = nowFn();
    const sample = (): void =>
      subsystems.diagnostics.recordFrame(accumulatedMs, nowFn() - startedMs);

    let deferred = false;
    try {
      // Step 3. The fit is taken before any game code runs, so a tick that
      // converts a point uses the fit this frame renders through, and the
      // screen layer is resized to the stage it will be composited onto in the
      // same breath.
      viewport = syncCanvas(canvas, width, height, surface);
      pipeline.syncScreen();

      // Steps 4 through 8, then the deferred destroys: the worlds subsystem's
      // half of the frame, in seconds.
      subsystems.worlds.tick(deltaMs / 1000);
      subsystems.worlds.flushDestroyed();

      const pending = subsystems.worlds.takeTransition();
      if (pending === null) {
        finishFrame(deltaMs);
        return;
      }
      deferred = true;
      return subsystems.worlds
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
    // A declined tick is not a frame: the simulation and the counters are left
    // exactly as they were.
    if (deltaMs === null) return;
    return runFrame(deltaMs);
  };

  /* ------------------------------------------------------------------ */
  /* The loop                                                            */
  /* ------------------------------------------------------------------ */

  let running = false;
  let rafHandle: number | null = null;

  /**
   * The promise every live `run` call shares, and the function that settles it.
   *
   * One promise rather than one per call: a second `run` while the loop is
   * already running is a caller asking to wait for the halt, not to start a
   * second pump, and two pumps over one clock would double every frame.
   */
  let pendingRun: Promise<void> | null = null;
  let settleRun: (() => void) | null = null;

  /**
   * How each watched signal is unwatched again. Emptied on every halt, so it is
   * bounded by the callers currently waiting on a run.
   */
  const unwatch = new Set<() => void>();

  /**
   * The transition the loop is waiting out, or `null`.
   *
   * The loop runs no frame while one is in flight — the pump re-arms without
   * consulting the clock, so a paced clock's grid is not consumed by ticks that
   * cannot become frames — and `advance` awaits it before its next tick.
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
   * Halt the loop, drop any frame already scheduled, and resolve every waiting
   * `run`. Idempotent, because teardown races the signal it is racing. Aborting
   * a run's signal lands here and leaves the engine usable, which is what makes
   * it a separate act from `destroy`.
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
      register: (name, binding): void =>
        subsystems.input.register(name, binding),
      layout: (): TouchLayout | null => subsystems.input.layout(),
    },
    audio: {
      define: (cue, spec): void => subsystems.audio.define(cue, spec),
      load: (cue, path): Promise<void> => subsystems.audio.load(cue, path),
    },
    assets: subsystems.assets,
    diagnostics: {
      register: (name, source): void =>
        subsystems.diagnostics.registerInstance(name, source),
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
    subsystems.diagnostics.toggle();
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
    subsystems.audio.unlock();
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
      return (built as { instance: GameInstance<D>; debug: D }).instance;
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
     * The one scene the engine renders, created empty at construction and kept
     * for the engine's life. The pipeline owns its contents; a caller reads it
     * for what the pipeline placed.
     */
    get scene(): THREE.Scene {
      return pipeline.scene;
    },

    /**
     * The value the instance's `initialize` returned, unchanged. The engine
     * reads no member of it, and a game with no surface put `null` here.
     */
    get debug(): D {
      requireReady("debug");
      return (built as { instance: GameInstance<D>; debug: D }).debug;
    },

    /**
     * Construct the game instance, run its `initialize`, open `startLevel`, and
     * resolve to the instance.
     *
     * Every call after the first hands back the *same* promise, which is what
     * makes a second call resolve to the instance already built — and what stops
     * a caller that cannot easily tell whether initialization has happened from
     * running the game's declarations twice, registering every action and cue a
     * second time. A rejection is shared for the same reason: re-running an
     * `initialize` that failed halfway would re-declare whatever it managed to
     * declare before it did.
     */
    initialize(): Promise<GameInstance<D>> {
      starting ??= (async (): Promise<GameInstance<D>> => {
        const InstanceClass =
          game.instance ?? (GameInstance as GameInstanceClass<D>);
        const instance = new InstanceClass();
        // `engine` and `events` are declared readonly on the class and assigned
        // exactly once, here, before any line of game code runs.
        bindGameInstance(instance, engine, bus);
        const returned = await instance.initialize(initApi);
        // The shape is checked here rather than trusted to the type, because a
        // game reaches the engine as a built module the type system has not
        // seen: `undefined` held as the debug surface would read as "the engine
        // lost it" on an unrelated later line.
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
        await subsystems.worlds.open(game.startLevel, undefined);
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
     * exactly the teardown paths that are hardest to order, and a refusal there
     * would turn a benign race into a failure.
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
     * Tick the clock `frames` times, back to back, running a frame for each tick
     * the clock accepts.
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
     * out of the game's own ticks *rejects*, because the frames were running by
     * then; the remaining frames are abandoned, since a caller stepping an exact
     * count needs the failure rather than the frames after it.
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
     * accumulated time describe the run, not the clock, and resetting them on a
     * swap would make "how far has this game got" depend on how many times the
     * driver changed its mind.
     */
    setClock(next: Clock): void {
      clock = next;
    },

    frame: frameInfo,

    viewport: snapshot,

    /**
     * Read the registered diagnostics, off the engine rather than off the panel.
     *
     * Registration is the game's part and drawing the overlay is the engine's,
     * so a check that wants to know what the game named reads here instead of
     * inspecting what the panel drew.
     */
    diagnostics: (): readonly DiagnosticReading[] =>
      subsystems.diagnostics.read(),

    recording: (): boolean => recorder.active,

    /**
     * Arm the recorder, so the frames from here on are captured.
     *
     * The current frame counter is what the arming is bounded against: capture
     * begins at the next frame rather than part-way through the current one,
     * because a recorder armed from inside a tick or a `DrawComponent`'s `draw`
     * would otherwise put a frame it watched only the tail of at the head of the
     * recording. A second call while already recording is refused rather than
     * silently discarding what has been captured — the mistake is always an
     * unbalanced `stopRecording`, and a caller told about it loses nothing.
     */
    startRecording(): void {
      recorder.start(frameCount);
    },

    /**
     * Disarm the recorder and hand back what it captured.
     *
     * Refuses when nothing is being recorded, for the same reason
     * `startRecording` refuses a second arming: an empty recording returned from
     * an unbalanced call reads as "the build drew nothing", which is a claim
     * about the build rather than about the caller.
     */
    stopRecording(): Promise<Recording> {
      return recorder.stop();
    },

    /**
     * Close the world, run the instance's `shutdown`, halt the loop, discard an
     * armed capture, dispose the renderer, and drop every listener.
     *
     * Idempotent, because teardown races: a page unload, an explicit call, and a
     * test's `afterEach` all reach here, and only the first one has anything to
     * do. The loop is halted first so no frame runs into a world that is
     * closing, the audio bus is silenced so a looping cue does not outlive the
     * engine that started it, the capture is dropped rather than flushed because
     * its frames were evidence for a check that is no longer running, and the
     * subscriptions go last: a handler typically closes over the caller's own
     * scene, and leaving the bus subscribed after teardown keeps that scope
     * alive.
     */
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      halt();
      if (ready) subsystems.worlds.close();
      if (built !== null) built.instance.shutdown();
      subsystems.audio.silence();
      subsystems.input.detach();
      recorder.discard();
      pipeline.dispose();
      target.removeEventListener("keydown", onOverlayKey);
      removeUnlockListeners();
      bus.clear();
    },
  };

  return engine;
}
