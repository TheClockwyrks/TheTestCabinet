/**
 * `@test-cabinet/simple-3d` — the **Simple 3D** engine: the runtime a produced 3D
 * game is built on, and the wiring that assembles it.
 *
 * The engine owns the parts of a browser 3D game that are the same in every 3D
 * game and are, every single time, re-derived slightly wrong:
 *
 * - **The frame loop and its delta time** — a replaceable {@link Clock} answers how
 *   much each frame is worth, so the sequence a validator steps through
 *   synchronously is the sequence a reviewer watches play.
 * - **The canvas fit and the camera** — a letterboxed, centred,
 *   device-pixel-ratio-aware map from the game's fixed logical design size onto
 *   whatever size the page gave the element, resynced every frame so a resize needs
 *   no handler at all, with the frustum's aspect taken from the design size so the
 *   picture is the same on every canvas.
 * - **The renderer** — a WebGL2 pipeline behind a write-only
 *   {@link SceneContext}: the clear and the depth reset, the four render modes, the
 *   lights, the procedural geometries, glTF meshes and their clips, billboards,
 *   lines, and HUD lettering in the engine's own bitmap face.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, with edge detection done once and correctly, and a
 *   pointer mapped into the game's own logical coordinates.
 * - **Audio** — cues played by name, synthesized or file-backed, and the
 *   first-gesture unlock a browser insists on.
 * - **Assets** — resolution and loading of meshes, textures, materials, and audio
 *   under one fixed root.
 * - **Diagnostics** — an overlay of values the game names, its frame-time graph,
 *   and the key that toggles it, drawn on a 2D surface of its own above the
 *   picture rather than into it.
 * - **Draw-command recording** — an opt-in flight recorder inside the scene
 *   context, so a scenario a check drove can be replayed as the operations the
 *   build issued.
 * - **The debug surface** — the object a game returns beside its state from
 *   `initialize`, held and returned off the engine, so a check poses a scenario
 *   through the engine it built rather than through the page the build is drawn on.
 * - **The state, held by value** — the game's state is a value each frame replaces
 *   rather than an object each frame writes into: `update` is handed a read-only
 *   view and returns the next state, `render` is handed the same view and returns
 *   nothing, and a caller poses the game through {@link Engine.apply}, a
 *   transition of the same shape. Rendering cannot change the state and nothing
 *   but a transition advances it, and the compiler is what says so.
 *
 * This module is the wiring and the shared vocabulary of the engine's own surface,
 * and nothing else: every behaviour above belongs to a subsystem beside it, and
 * what is decided *here* is which subsystem talks to which, and in what order a
 * frame's steps happen. Three of those decisions are worth stating up front,
 * because a game and a validator both depend on them:
 *
 * 1. **Construction runs no game code.** {@link createEngine} validates, builds, and
 *    returns. The game's own `initialize` runs later, from
 *    {@link Engine.initialize}, which is what lets a caller subscribe to
 *    {@link Engine.events} first and observe the game's loading as it happens
 *    instead of inferring it afterwards.
 * 2. **Observation is by event.** Nothing here accumulates a log of what a run did.
 *    A subscriber keeps exactly what it decided was worth keeping, and the engine's
 *    footprint is the same after a million frames as after one.
 * 3. **Every measurement goes through a {@link SurfaceMetrics}.** The element's
 *    size, the device pixel ratio, and the target the key and pointer listeners go
 *    on all arrive through that one seam, so the same engine runs over a canvas in
 *    a page and over the headless canvas a validator renders through.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 640, height: 360, game });
 * await engine.initialize();
 * await engine.run({ signal: controller.signal });
 * ```
 */

import { AssetLoader } from "./assets";
import type { MaterialHandle, MeshHandle, TextureHandle } from "./assets";
import type { AssetEventEmitter, AssetEventMap } from "./assets";
import { AudioBus } from "./audio";
import type { AudioEventMap, CueEventEmitter, CueSpec } from "./audio";
import { WallClock } from "./clocks";
import type { Clock } from "./clocks";
import type { Recording } from "./contract";
import { Diagnostics, createOverlaySurface } from "./diagnostics";
import { EventBus } from "./events";
import type { FrameCallbacks, FrameInfo, RunOptions } from "./frame";
import { FrameLoop } from "./frame";
import { InputRegistry } from "./input";
import type { ActionBinding } from "./input";
import type { TouchLayout } from "./layouts";
import type { Viewport } from "./math";
import { PointerInput } from "./pointer";
import type { PointerSample, PointerSnapshot } from "./pointer";
import { SceneRenderer } from "./renderer";
import { Scene } from "./scene";
import type { SceneContext } from "./scene";
import type { DeepReadonly } from "ts-essentials";
import { domSurface, syncCanvas } from "./viewport";
import type { SurfaceMetrics } from "./viewport";

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The events the subsystems publish, as the subsystems declare them: the asset
 * loader's `asset:loaded` and `asset:failed`, and the audio bus's `cue:played`,
 * `cue:looped`, `cue:stopped`, and `audio:unlocked`.
 */
type SubsystemEventMap = AssetEventMap & AudioEventMap;

/**
 * Every event the engine publishes, with the payload each carries — the six of
 * {@link SubsystemEventMap}, flattened into one map.
 *
 * Derived rather than copied out. A hand-written list would be a second place for
 * `cue:played`'s payload to be described, and the two would eventually disagree
 * about a field the docs describe once; deriving makes the engine's map the
 * subsystems' maps by construction, so an event that changed shape changes here
 * with it rather than quietly parting company with what the bus carries. The
 * flattening is what an intersection cannot do on its own: the event bus's type
 * parameter is constrained to `Record<string, unknown>`, and a mapped type
 * satisfies that where an intersection of interfaces does not.
 */
export type EngineEventMap = {
  [K in keyof SubsystemEventMap]: SubsystemEventMap[K];
};

/**
 * How a game or a validator watches the engine work.
 *
 * Subscription only: the engine publishes, and nothing a game holds can publish
 * an engine event of its own invention. `on` returns the function that removes
 * the handler, so a subscriber unsubscribes with the value it already has rather
 * than by re-naming the event and the function.
 */
export interface EngineEvents {
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

/* -------------------------------------------------------------------------- */
/* The game                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A change to the state made from outside a frame: the shape `update` has, minus
 * the frame.
 *
 * It is what a caller hands {@link Engine.apply} to pose the game between frames,
 * and what a debug surface's poses are written as.
 */
export type Transition<S> = (state: DeepReadonly<S>) => S;

/**
 * The game the engine drives: three functions over two types of the game's own.
 *
 * `S` is the state, held by the engine as a value each frame replaces; `D` is the
 * debug surface returned beside it, which the engine holds and reads no member of.
 * Both are inferred from the game handed to {@link createEngine}, so a validator
 * that names them names the game's own types.
 */
export interface Game<S, D = unknown> {
  /** Declare, load, and build the opening state and the debug surface beside it. */
  initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
  /** Advance the simulation by `dt` seconds and return the next state. */
  update(state: DeepReadonly<S>, api: UpdateApi, dt: number): S;
  /** Draw the state `update` returned. Returns nothing, and changes nothing. */
  render(state: DeepReadonly<S>, api: RenderApi): void;
}

/**
 * What a game may reach while it initializes: everything it declares once.
 *
 * Generic over the state so a diagnostic source is typed against the game's own
 * `S` — a source is called with the state current at each read, never with the
 * one `initialize` built, because each frame replaces the value.
 */
export interface InitApi<S = unknown> {
  readonly input: {
    /** Register or re-register an action. Re-registering replaces the binding wholesale. */
    register(name: string, binding: ActionBinding): void;
    /** The selected touch layout as a fresh copy, or `null` when none was selected. */
    layout(): TouchLayout | null;
  };
  readonly audio: {
    /** Declare a synthesized cue. */
    define(cue: string, spec: CueSpec): void;
    /** Declare a file-backed cue, resolving once its file is decoded. */
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    /** Load a glTF binary mesh. */
    loadMesh(path: string): Promise<MeshHandle>;
    /** Load a PNG texture. */
    loadTexture(path: string): Promise<TextureHandle>;
    /** Load a material document and every map it names, in one call. */
    loadMaterial(path: string): Promise<MaterialHandle>;
    /** Load and decode a PCM WAV, with or without an audio context behind it. */
    loadAudio(path: string): Promise<AudioBuffer>;
    /** Load a file the engine has no opinion about, as a `Blob`. */
    load(path: string): Promise<Blob>;
    /** The URL a path resolves to under the asset root. Pure: it fetches nothing. */
    resolve(path: string): string;
  };
  readonly diagnostics: {
    /** Name a value for the overlay. Re-registering a name keeps its position. */
    register(name: string, source: (state: DeepReadonly<S>) => unknown): void;
  };
  /** The engine's events, subscribable from before the game's first declaration. */
  readonly events: EngineEvents;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
}

/**
 * What a game may reach while it updates: input, audio, and the frame's own
 * figures.
 *
 * Nothing here draws, which is what leaves a frame's audible and observable
 * behaviour entirely to the update and lets a simulation be stepped and inspected
 * with no drawing surface taking part in the result.
 */
export interface UpdateApi {
  readonly input: {
    /** The action's resolved magnitude; `0` for a name nothing registered. */
    value(name: string): number;
    /** Whether the action was pressed since the last frame. The read consumes the edge. */
    pressed(name: string): boolean;
    /** The pointer's most recent position and hold, as a fresh copy. */
    pointer(): PointerSnapshot;
    /** Whether the pointer was pressed since the last frame. The read consumes the edge. */
    pointerPressed(): boolean;
    /** Whether the pointer was released since the last frame. The read consumes the edge. */
    pointerReleased(): boolean;
    /**
     * The pointer samples delivered since the input frame last closed, in arrival
     * order, as a fresh copy. Reading does not consume the list.
     */
    pointerSamples(): PointerSample[];
  };
  readonly audio: {
    /** Play a declared cue once. */
    play(cue: string): void;
    /** Start a declared cue looping. Nothing happens if it already is. */
    loop(cue: string): void;
    /** Stop a looping cue. Nothing happens if it is not looping. */
    stop(cue: string): void;
    /** Whether a cue is looping. `false` for an undeclared cue. */
    looping(cue: string): boolean;
    /** Mute or unmute the bus. Every running loop follows the bit live. */
    setMuted(muted: boolean): void;
    /** Whether the bus is muted. */
    muted(): boolean;
  };
  /** The frame counter, the accumulated simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/**
 * What a game may reach while it renders: the scene context and the frame's
 * figures.
 *
 * Nothing here reads input or plays a cue, so a frame's picture follows from the
 * state the update returned and from nothing else.
 */
export interface RenderApi {
  /** The engine-owned 3D drawing surface, cleared before every frame. */
  readonly scene: SceneContext;
  /** The frame counter, the accumulated simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

/** What {@link createEngine} is given. Only the first four have no default. */
export interface EngineOptions<S, D = unknown> {
  /** The canvas the engine sizes, clears, and renders through, via its WebGL2 context. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game's picture is projected into. Finite and positive. */
  width: number;
  /** The logical design height the game's picture is projected into. Finite and positive. */
  height: number;
  /** The game this engine drives, for the engine's whole lifetime. */
  game: Game<S, D>;
  /** A CSS color cleared to before every frame. Absent, the frame clears to transparency. */
  background?: string;
  /** A touch layout from the catalogue, whose vocabulary the game then registers. */
  layout?: string;
  /** The clock supplying each frame's delta. Defaults to a {@link WallClock}. */
  clock?: Clock;
  /** Where the engine reads element size, pixel ratio, and its event target. */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under. Defaults to `"assets/"`. */
  assetRoot?: string;
}

/** The engine {@link createEngine} returns: the whole surface a caller drives. */
export interface Engine<S, D = unknown> {
  /** Subscribe to engine events. Available from construction, before any game code runs. */
  readonly events: EngineEvents;
  /** The current state, as a read-only view: the value the most recent transition left. */
  readonly state: DeepReadonly<S>;
  /** The debug surface the game returned beside its state, unchanged. */
  readonly debug: D;
  /** Run the game's `initialize` and resolve to the state it produced. */
  initialize(): Promise<DeepReadonly<S>>;
  /** Replace the state with what `transition` makes of the current one, and return it. */
  apply(transition: Transition<S>): DeepReadonly<S>;
  /** Drive frames off the host's frame callback until the signal aborts or the engine is destroyed. */
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
  /** Halt the loop and drop every listener. Idempotent. */
  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The key that toggles the debug overlay.
 *
 * Backtick, because it is the traditional debug-console key and no game binds it
 * for gameplay. It is handled by a listener the engine owns rather than by a
 * registered action, deliberately: the action registry is the read that says what
 * vocabulary a *build* bound, and it stays exactly that — the game's own — only if
 * the engine keeps its chrome out of it.
 */
const OVERLAY_TOGGLE_CODE = "Backquote";

/** `true` for a logical design dimension the viewport arithmetic can use. */
function isDesignSize(size: number): boolean {
  return Number.isFinite(size) && size > 0;
}

/**
 * Build an engine over `options.canvas`, bound to `options.game`, and wire its
 * parts together.
 *
 * Synchronous, and it runs no game code: it validates its arguments, builds the
 * subsystems, and attaches the engine's own listeners. The game's `initialize`
 * runs from {@link Engine.initialize} and the first frame from {@link Engine.run}
 * or {@link Engine.advance}, so an engine exists — subscribable, with its clock
 * replaceable — before anything the game does is observable.
 *
 * The per-frame order is the engine's real contribution, and it is what a game gets
 * for free:
 *
 * 1. **Before `update`** the canvas is resynced to its element and the device pixel
 *    ratio and the fit is recomputed, and the frame bracket opens over the renderer
 *    state this frame inherits. Doing the resync every frame rather than from a
 *    `resize` handler is what makes the fit correct on first paint, after a window
 *    resize, after a device-pixel-ratio change, and after a layout change no
 *    `resize` event fires for — with no handler at all, and no chance of the first
 *    frame drawing into a canvas that was never sized.
 * 2. **`update` runs with `dt` in seconds**, reading input and playing cues through
 *    an API that cannot draw.
 * 3. **`render` issues the frame's draws** into the engine-owned scene context,
 *    through an API that cannot read input or play a cue; the renderer then clears
 *    the canvas, pins the fit as its device viewport and scissor, and draws the
 *    whole frame at once. A game's own coordinates are world units and logical HUD
 *    units throughout, so letterboxing simply does not appear in its code.
 * 4. **After `render`** the diagnostics overlay is drawn on its own 2D surface above
 *    the finished picture — never into it, so debug chrome stays out of a
 *    reviewer's evidence — and the input frame is closed so an edge-triggered
 *    action is consumed exactly once.
 *
 * @throws if the design size is not finite and positive, if the canvas yields no
 * WebGL2 context, or if `layout` is outside the catalogue. Each otherwise presents
 * as a build that runs and draws nothing, which is the most expensive kind of
 * failure to trace, so each is refused where it happens.
 */
export function createEngine<S, D = unknown>(
  options: EngineOptions<S, D>,
): Engine<S, D> {
  const { canvas, width, height, game } = options;
  const background = options.background ?? null;

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

  // Built before anything is attached or subscribed, because compiling the
  // engine's shaders is the other construction step that can fail: a refusal here
  // must leave the page exactly as it found it, and it does so trivially while
  // there is still nothing to undo.
  const renderer = new SceneRenderer(gl);

  // Read once and held: the surface is the engine's only window onto the element,
  // and re-deriving it per frame would let a build be measured through one object
  // and listened to through another.
  const surface: SurfaceMetrics = options.surface ?? domSurface(canvas);
  const target = surface.events();

  // First, so `engine.events` is subscribable the instant the engine exists and no
  // subsystem below can be built holding a reference to a bus that is not the one a
  // caller will subscribe to. The label names this engine in a contained handler's
  // console report.
  const bus = new EventBus<EngineEventMap>("simple-3d");

  /**
   * How every subsystem publishes: one closure over the one bus, checked against
   * the engine's own map, and handed on through the narrower view each subsystem
   * declares.
   *
   * {@link EngineEventMap} *is* {@link SubsystemEventMap} flattened, so each of
   * those views describes the same six events with the same payloads. What the
   * compiler will not do is relate two generic signatures whose key sets differ —
   * it has to answer for an unresolved `K` and gives up — so the narrowing is
   * asserted here, once, where the closure's own declaration has already fixed
   * what it accepts.
   */
  const emit = <K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void => bus.emit(event, payload);
  const emitAsset = emit as AssetEventEmitter;
  const emitCue = emit as CueEventEmitter;

  const input = new InputRegistry(surface);
  try {
    if (options.layout !== undefined) input.useLayout(options.layout);
  } catch (error) {
    // The registry attached its key listeners at construction, and a refused layout
    // means no engine is returned to detach them with. Undo before rethrowing, so a
    // rejected build leaves the page exactly as it found it.
    input.detach();
    throw error;
  }

  // `assetRoot` is passed through rather than defaulted here: the loader owns the
  // convention, and a second copy of `"assets/"` in this file is a second place for
  // it to be changed in.
  const assets = new AssetLoader({ root: options.assetRoot, emit: emitAsset });
  const audio = new AudioBus({
    emit: emitCue,
    // Frame time rather than wall time, so a cue's `t` lines up with the
    // `frame().timeMs` a check asserts against. Frames stepped through `advance`
    // run back to back with no real time between them, and a wall stamp would put
    // every cue of a several-hundred-frame advance at the same instant. Before any
    // frame has run the sum is zero, which is what stamps a cue played from the
    // game's own initialization with `t: 0` and needs no special case to do it.
    now: (): number => loop.info().timeMs,
    // Through the loader, so a file-backed cue obeys the asset root, the path
    // rules, and the `asset:loaded` / `asset:failed` events like any other asset.
    loadAudio: (path: string): Promise<AudioBuffer> => assets.loadAudio(path),
  });
  const diagnostics = new Diagnostics();
  // The overlay draws on a 2D surface of its own, because the canvas the engine
  // renders through yielded a WebGL2 context and therefore yields no 2D one. In an
  // environment that can make no 2D surface at all this is `null` and the overlay
  // is inert, while `read` and the metrics answer as always.
  const overlay = createOverlaySurface(canvas);
  const scene = new Scene({ width, height, background });

  /**
   * The state and debug surface the game built, or `null` before it has built
   * them.
   *
   * A box rather than bare `S | null` and `D | null` slots, because either may
   * perfectly well *be* `null`: a game whose surface is `null` is the common case,
   * but a game is entitled to any two types it likes, and "has it been built" must
   * not be answered by inspecting the values. One box for both, because they
   * arrive together — the pair `initialize` returned — and there is no moment at
   * which one exists without the other.
   */
  let built: { state: S; debug: D } | null = null;
  let starting: Promise<DeepReadonly<S>> | null = null;
  let destroyed = false;

  /**
   * The state, or a refusal naming the ordering.
   *
   * Every public entry point that needs the game's state goes through here, so the
   * rule is stated once and every violation of it reads the same. The message names
   * both halves of the ordering, because the mistake is never "there is no state" on
   * its own — it is always "this was reached before the state was built".
   */
  const requireState = (member: string): DeepReadonly<S> => {
    if (built === null) {
      throw new Error(
        `engine.${member} was reached before the game's state was built: await engine.initialize() first`,
      );
    }
    return built.state as DeepReadonly<S>;
  };

  /**
   * The box, as a frame reads it.
   *
   * Separate from {@link requireState} because it cannot fail: no frame runs before
   * `initialize` resolves, since both entry points that produce one refuse first.
   * It exists so the invariant is stated where the frame depends on it rather than
   * being asserted away, and its message says "engine bug" rather than blaming a
   * caller who did nothing wrong.
   */
  const frameBuilt = (): { state: S; debug: D } => {
    if (built === null) {
      throw new Error(
        "simple-3d: a frame ran before the game's state was built",
      );
    }
    return built;
  };

  /**
   * Replace the state with what `transition` makes of the current one.
   *
   * The one place the held state changes, shared by the frame's update and by
   * {@link Engine.apply}, so the rule about what a transition may return is stated
   * once. `undefined` is refused rather than held: a game whose `update` mutated
   * the state it was handed and returned nothing has advanced nothing the engine
   * will ever read again, and holding `undefined` would turn that one mistake into
   * a crash on an unrelated line of the next frame. `who` names the transition in
   * the refusal, because the same mistake is made in both places.
   */
  const transition = (
    box: { state: S; debug: D },
    next: S | undefined,
    who: string,
  ): DeepReadonly<S> => {
    if (next === undefined) {
      throw new Error(
        `${who} must return the next state — the state is read-only where it is handed over, and the value returned is the state the engine holds from here on`,
      );
    }
    box.state = next;
    return next as DeepReadonly<S>;
  };

  // Sized once up front, so `viewport()` and the game's own initialization see a
  // real fit rather than a zero one before the first frame runs.
  let viewport = syncCanvas(canvas, width, height, surface);

  // After the layout gate above: a refused layout detaches the key listeners and
  // rethrows, and constructing the pointer past that point means there is never a
  // moment where its listeners exist with no engine to detach them.
  const pointer = new PointerInput(surface, () => viewport);

  /** The fit as a caller owns it — a copy, so holding one observes no later frame. */
  const snapshot = (): Viewport => ({
    width: viewport.width,
    height: viewport.height,
    scale: viewport.scale,
    offsetX: viewport.offsetX,
    offsetY: viewport.offsetY,
  });

  /** The canvas's backing store, in device pixels — what the renderer draws into. */
  const store = (): { width: number; height: number } => ({
    width: canvas.width,
    height: canvas.height,
  });

  // The three scoped APIs are built once and reused for the life of the engine,
  // rather than per frame: they are stateless views onto the subsystems, a frame
  // that allocated three objects and a dozen closures would do so sixty times a
  // second for no gain, and a game that holds on to the one it was handed keeps
  // reading the live engine rather than a stale snapshot of it.
  //
  // Each is a facade rather than the subsystem itself. Structural typing would
  // happily accept the whole `InputRegistry` where `UpdateApi["input"]` is asked
  // for, and that would hand the game `setAction`, `detach`, and the rest; naming
  // the members explicitly is what makes "each function receives only the part of
  // the engine it may use" true rather than merely documented.
  const initApi: InitApi<S> = {
    input: {
      register: (name, binding): void => input.register(name, binding),
      layout: () => input.layout(),
    },
    audio: {
      define: (cue, spec): void => audio.define(cue, spec),
      load: (cue, path): Promise<void> => audio.load(cue, path),
    },
    assets: {
      loadMesh: (path): Promise<MeshHandle> => assets.loadMesh(path),
      loadTexture: (path): Promise<TextureHandle> => assets.loadTexture(path),
      loadMaterial: (path): Promise<MaterialHandle> =>
        assets.loadMaterial(path),
      loadAudio: (path): Promise<AudioBuffer> => assets.loadAudio(path),
      load: (path): Promise<Blob> => assets.load(path),
      resolve: (path): string => assets.resolve(path),
    },
    diagnostics: {
      // The source is handed the state current at the read, because each frame
      // replaces the value and a source that closed over the initial one would
      // report the title screen forever. The registry itself knows nothing of
      // state, so the binding happens here.
      register: (name, source): void =>
        diagnostics.register(name, () =>
          source(frameBuilt().state as DeepReadonly<S>),
        ),
    },
    events: bus,
    viewport: snapshot,
  };

  const updateApi: UpdateApi = {
    input: {
      value: (name): number => input.value(name),
      pressed: (name): boolean => input.pressed(name),
      pointer: () => pointer.snapshot(),
      pointerPressed: (): boolean => pointer.pressed(),
      pointerReleased: (): boolean => pointer.released(),
      pointerSamples: () => pointer.samples(),
    },
    audio: {
      play: (cue): void => audio.play(cue),
      loop: (cue): void => audio.loop(cue),
      stop: (cue): void => audio.stop(cue),
      looping: (cue): boolean => audio.looping(cue),
      setMuted: (muted): void => audio.setMuted(muted),
      muted: (): boolean => audio.muted(),
    },
    frame: (): FrameInfo => loop.info(),
    viewport: snapshot,
  };

  const renderApi: RenderApi = {
    scene,
    frame: (): FrameInfo => loop.info(),
    viewport: snapshot,
  };

  /**
   * The game, as the loop drives it.
   *
   * The canvas work runs at the top of the update rather than as a step of its own
   * because the loop knows only about two callbacks and a set of after-frame hooks:
   * the resync has to happen inside the frame and before the game reads a viewport,
   * and wrapping is what keeps the loop ignorant of the canvas entirely.
   *
   * Both read the box through `frameBuilt`, which cannot fail here — no frame runs
   * before `initialize` resolves — but which keeps the invariant stated at the point
   * that depends on it instead of leaving a non-null assertion behind. The update's
   * return value is the state the frame leaves: `render` draws it, and the next
   * frame receives it.
   */
  const callbacks: FrameCallbacks = {
    update: (dt: number): void => {
      viewport = syncCanvas(canvas, width, height, surface);
      // The frame bracket opens before the game's update rather than before its
      // render, because the renderer state a frame inherits is the state standing
      // when the frame began — and because a recording's frames must be whole.
      scene.beginFrame(store());
      const box = frameBuilt();
      transition(
        box,
        game.update(box.state as DeepReadonly<S>, updateApi, dt),
        "the game's update",
      );
    },
    render: (): void => {
      const box = frameBuilt();
      scene.enterRender();
      try {
        game.render(box.state as DeepReadonly<S>, renderApi);
      } finally {
        // In a `finally`, so a render that threw does not leave the scene context
        // live for an `update` or a stored closure to draw through afterwards. The
        // frame itself is left open: it is closed below only on the path where the
        // game finished it, so a recording carries whole frames alone.
        scene.exitRender();
      }
      const info = loop.info();
      const frame = scene.endFrame({
        count: info.count,
        timeMs: info.timeMs,
        deltaMs: info.lastDeltaMs,
      });
      renderer.renderFrame({ viewport, surface: store(), background, frame });
    },
  };

  const loop = new FrameLoop({
    clock: options.clock ?? new WallClock(),
    callbacks,
  });

  // Late-wired, because the overlay and the loop each need the other: the loop's
  // frames are what there is to time, and the overlay is what reports the timing.
  diagnostics.timings = {
    metrics: () => loop.metrics(),
    series: () => loop.series(),
  };

  loop.onFrame(() => {
    if (overlay !== null) {
      // Synced whether or not the panel is enabled, so a panel switched off leaves
      // no ghost of itself over the picture, and always in device pixels: the
      // overlay is chrome laid over the finished frame rather than part of it, so
      // it holds one physical size however far the game's world is being scaled.
      const size = store();
      overlay.sync(size.width, size.height);
      diagnostics.draw(overlay.context(), size.width, size.height);
    }
    // Last, so an edge armed during this frame was available to the game's update
    // and is gone before the next one: a press is news for exactly one frame.
    input.endFrame();
    pointer.endFrame();
  });

  const onOverlayKey = (event: Event): void => {
    const key = event as KeyboardEvent;
    // An auto-repeat would strobe the panel for as long as the key is held.
    if (key.code !== OVERLAY_TOGGLE_CODE || key.repeat) return;
    diagnostics.toggle();
  };
  target.addEventListener("keydown", onOverlayKey);

  /**
   * Browsers refuse to start audio outside a user gesture, so the bus stays locked
   * until the player touches something. Listening in the capture phase means a game
   * that consumes its own canvas events cannot accidentally prevent the unlock, and
   * both listeners come off as soon as either fires — one gesture is all that is
   * needed, and the bus's own unlock is idempotent regardless.
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

  return {
    events: bus,

    get state(): DeepReadonly<S> {
      return requireState("state");
    },

    /**
     * Pose the game between frames: replace the state with what `transition`
     * returns from the current one, and hand the new state back.
     *
     * Goes through the same gate the frame's update does, so a transition that
     * returns nothing is refused with the same words, and through the same
     * ordering check every other entry point uses, so reaching it before
     * `initialize` resolves reads like reaching `engine.state` early.
     */
    apply(fn: Transition<S>): DeepReadonly<S> {
      const current = requireState("apply");
      return transition(
        frameBuilt(),
        fn(current),
        "a transition applied through engine.apply",
      );
    },

    /**
     * The surface the game returned beside its state, or a refusal naming the
     * ordering.
     *
     * Worded like {@link requireState}'s refusal, because the mistake is the same
     * one: reaching for it before `initialize` has resolved. There is no "never
     * returned one" case — the pair `initialize` returns always carries a surface,
     * and a game with none says so with `null`.
     */
    get debug(): D {
      if (built === null) {
        throw new Error(
          "engine.debug was reached before the game's state was built: await engine.initialize() first — the game's initialize returns its debug surface beside its state, as [state, debug]",
        );
      }
      return built.debug;
    },

    /**
     * Run the game's `initialize` once and resolve to the state it produced.
     *
     * Every call after the first hands back the *same* promise, which is what makes
     * a second call resolve to the state already built — and what stops a caller
     * that cannot easily tell whether initialization has happened from running the
     * game's declarations twice, registering every action and cue a second time.
     *
     * A rejection is shared for the same reason: re-running an `initialize` that
     * failed halfway would re-declare whatever it managed to declare before it did.
     */
    initialize(): Promise<DeepReadonly<S>> {
      starting ??= (async (): Promise<DeepReadonly<S>> => {
        const returned: unknown = await game.initialize(initApi);
        // The shape is checked here rather than trusted to the type, because a
        // game reaches the engine as a built module and the type system has not
        // seen it: a bare state returned where the pair belongs would be held as
        // the state and leave `engine.debug` reading nothing the game meant.
        if (!Array.isArray(returned) || returned.length !== 2) {
          throw new Error(
            "the game's initialize must return [state, debug] — its state and its debug surface as a two-element array (a game with no debug surface returns [state, null])",
          );
        }
        const [state, debug] = returned as [S, D];
        built = { state, debug };
        return state as DeepReadonly<S>;
      })();
      return starting;
    },

    /**
     * Drive frames off the host's frame callback until the signal aborts or the
     * engine is destroyed.
     *
     * A destroyed engine has already halted, so this resolves rather than starting a
     * pump nothing would ever stop: `destroy` and `run` race in exactly the teardown
     * paths that are hardest to order, and a refusal there would turn a benign race
     * into a failure.
     */
    run(runOptions: RunOptions = {}): Promise<void> {
      requireState("run");
      if (destroyed) return Promise.resolve();
      return loop.run(runOptions);
    },

    /**
     * Tick the clock `frames` times, back to back, running a frame for each tick the
     * clock accepts.
     *
     * The frames run *synchronously*, before the returned promise is handed back —
     * the promise is there so a caller can `await` a step uniformly, not because
     * anything is deferred.
     *
     * Two kinds of failure are kept apart deliberately. A caller's own mistake — no
     * state yet, a count that is not a whole non-negative number — throws at the
     * call, where the mistake is, and reaches an `await`ing caller just the same. A
     * throw out of the game's `update` or `render` *rejects*, because the frames
     * were running by then and the failure belongs to them; the remaining frames are
     * abandoned, since a caller stepping an exact count needs the failure rather
     * than the frames after it.
     */
    advance(frames: number): Promise<void> {
      requireState("advance");
      if (!Number.isInteger(frames) || frames < 0) {
        throw new RangeError(
          `engine.advance() needs a whole, non-negative frame count, got ${frames}`,
        );
      }
      if (destroyed) return Promise.resolve();
      try {
        loop.advance(frames);
      } catch (error) {
        // Unwrapped: the cause travels as the game threw it, so the failure a caller
        // catches is the one its own code produced.
        return Promise.reject(error);
      }
      return Promise.resolve();
    },

    setClock(clock: Clock): void {
      loop.setClock(clock);
    },

    frame: (): FrameInfo => loop.info(),

    viewport: snapshot,

    /**
     * The recorder lives inside the scene context, so these three delegate rather
     * than reimplement: the surface every draw already passes through is the one
     * place that can see the calls, and the unbalanced-call refusals belong beside
     * the state they are about.
     */
    recording: (): boolean => scene.recording(),

    startRecording(): void {
      scene.startRecording();
    },

    stopRecording(): Recording {
      return scene.stopRecording();
    },

    /**
     * Halt the loop and drop every listener.
     *
     * Idempotent, because teardown races: a page unload, an explicit call, and a
     * test's `afterEach` all reach here, and only the first one has anything to do.
     *
     * The loop is halted first, so nothing can emit into a bus that is about to be
     * cleared, and the subscriptions go last: a handler typically closes over the
     * caller's own scene, and leaving the bus subscribed after teardown keeps that
     * scope alive and lets a stale handler observe a successor engine's events.
     *
     * In between, everything the engine put somewhere else comes back: the audio
     * bus is silenced, because a looping cue would otherwise outlive the engine that
     * started it; the scene context is closed for good, so a stored closure that
     * draws after teardown is refused rather than filling a frame nothing will
     * render; the overlay's own canvas leaves the document; and the renderer's
     * buffers, textures, and program are deleted off the context. Silencing
     * announces nothing, since the subscriptions are about to go with it.
     */
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loop.halt();
      input.detach();
      pointer.detach();
      target.removeEventListener("keydown", onOverlayKey);
      removeUnlockListeners();
      audio.silence();
      scene.destroy();
      overlay?.dispose();
      renderer.destroy();
      bus.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The entry point's surface                                                  */
/* -------------------------------------------------------------------------- */

export {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
  WallClock,
} from "./clocks";
export type { Clock, PacedClockOptions } from "./clocks";
export type { FrameMetrics } from "./diagnostics";
export type { FrameInfo, RunOptions } from "./frame";
export type { ActionBinding, ActionKind, RegisteredAction } from "./input";
export { TOUCH_LAYOUTS } from "./layouts";
export type { TouchLayout } from "./layouts";
export {
  quatFromAxisAngle,
  quatMultiply,
  rotateVec3,
  transformPoint,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "./math";
export type {
  Box3,
  CameraState,
  Quat,
  Ray,
  Transform,
  Vec2,
  Vec3,
  Viewport,
} from "./math";
export type {
  PointerSample,
  PointerSampleType,
  PointerSnapshot,
} from "./pointer";
export { RECORDING_FORMAT } from "./recording";
export type {
  DrawMeshOptions,
  Geometry,
  HudTextOptions,
  Material,
  MaterialLike,
  MaterialSpec,
  SceneContext,
} from "./scene";
export { fitViewport, pointerRay, projectPoint, syncCanvas } from "./viewport";
export type { SurfaceMetrics } from "./viewport";
export type { CueSpec, AudioState } from "./audio";
export type { MaterialHandle, MeshHandle, TextureHandle } from "./assets";
export type { DeepReadonly } from "ts-essentials";

/**
 * The recording format's whole vocabulary, re-exported wholesale.
 *
 * `contract.ts` is the format's type surface — it exists precisely so the
 * recorder, the engine, and the two 3D packages cannot drift apart, and it is
 * carried byte-identical between them — and re-exporting it as a list would add
 * another place for a type to be forgotten in. The contract's runtime values are
 * the recorder's own bounds rather than anything a game names, so nothing but
 * types is meant to cross, and `export type` is what says so.
 */
export type * from "./contract";
