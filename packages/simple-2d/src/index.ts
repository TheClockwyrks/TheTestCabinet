/**
 * `@test-cabinet/simple-2d` — the **Simple 2D** engine: the runtime a produced 2D
 * game is built on, and the wiring that assembles it.
 *
 * The engine owns the parts of a browser game that are the same in every browser
 * game and are, every single time, re-derived slightly wrong:
 *
 * - **The frame loop and its delta time** — a replaceable {@link Clock} answers how
 *   much each frame is worth, so the sequence a validator steps through
 *   synchronously is the sequence a reviewer watches play.
 * - **The canvas fit** — a letterboxed, centred, device-pixel-ratio-aware map from
 *   the game's fixed logical design size onto whatever size the page gave the
 *   element, resynced every frame so a resize needs no handler at all.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, with edge detection done once and correctly, and
 *   a pointer mapped into the game's own logical coordinates.
 * - **Audio** — cues played by name, synthesized or file-backed, and the
 *   first-gesture unlock a browser insists on.
 * - **Assets** — resolution and loading under one fixed root.
 * - **Diagnostics** — an overlay of values the game names, its frame-time graph,
 *   and the key that toggles it.
 * - **Draw-command recording** — an opt-in flight recorder over the drawing context,
 *   so a scenario a check drove can be replayed as the operations the build issued.
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
 * This module is the wiring and nothing else: every behaviour above belongs to a
 * subsystem beside it, and what is decided *here* is which subsystem talks to which,
 * and in what order a frame's steps happen. Three of those decisions are worth
 * stating up front, because a game and a validator both depend on them:
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
 *    size, the device pixel ratio, and the target the key listeners go on all
 *    arrive through that one seam, so the same engine runs over a canvas in a page
 *    and over a native canvas with no document behind it.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 640, height: 360, game });
 * await engine.initialize();
 * await engine.run({ signal: controller.signal });
 * ```
 */

import { AssetLoader } from "./assets";
import { AudioBus } from "./audio";
import { WallClock } from "./clocks";
import type {
  Clock,
  DeepReadonly,
  DiagnosticReading,
  Engine,
  EngineEventMap,
  EngineOptions,
  FrameInfo,
  InitApi,
  Recording,
  RenderApi,
  RunOptions,
  SurfaceMetrics,
  Transition,
  UpdateApi,
  Viewport,
} from "./contract";
import { Diagnostics } from "./diagnostics";
import { EventBus } from "./events";
import type { FrameCallbacks } from "./frame";
import { FrameLoop } from "./frame";
import { InputRegistry } from "./input";
import { PointerInput } from "./pointer";
import { ContextRecorder } from "./recording";
import { applyViewport, domSurface, syncCanvas } from "./viewport";

/**
 * The key that toggles the debug overlay.
 *
 * Backtick, because it is the traditional debug-console key and no 2D game binds
 * it for gameplay. It is handled by a listener the engine owns rather than by a
 * registered action, deliberately: the action registry is the read that says what
 * vocabulary a *build* bound, and it stays exactly that — the game's own — only if
 * the engine keeps its chrome out of it.
 */
const OVERLAY_TOGGLE_CODE = "Backquote";

/**
 * One audio context, built at most once, shared by whoever asks first.
 *
 * The asset loader decodes a produced sound file through a context, and the audio
 * bus plays the resulting buffer through one; a buffer belongs to the context that
 * decoded it, so those two must be the *same* context or a file-backed cue is
 * silent for a reason nothing reports. Which of them asks first is not fixed —
 * decoding happens during the game's initialization, the unlock happens on the
 * player's first gesture, and either can come first — so the factory memoizes
 * rather than the caller.
 *
 * A host with no Web Audio yields `null` and is asked again next time, so a context
 * that only appears later is still picked up. The retained state is one slot.
 */
function sharedAudioContext(): () => AudioContext | null {
  let context: AudioContext | null = null;
  return (): AudioContext | null => {
    if (context !== null) return context;
    const ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    context = ctor ? new ctor() : null;
    return context;
  };
}

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
 * runs from {@link Engine.initialize} and the
 * first frame from {@link Engine.run} or {@link Engine.advance}, so an engine
 * exists — subscribable, with its clock replaceable — before anything the game
 * does is observable.
 *
 * The per-frame order is the engine's real contribution, and it is what a game gets
 * for free:
 *
 * 1. **Before `update`** the canvas is resynced to its element and the device pixel
 *    ratio, the frame is cleared, and the viewport transform is applied. Doing this
 *    every frame rather than from a `resize` handler is what makes the fit correct
 *    on first paint, after a window resize, after a device-pixel-ratio change, and
 *    after a layout change no `resize` event fires for — with no handler at all, and
 *    no chance of the first frame drawing into a canvas that was never sized.
 * 2. **`update` runs with `dt` in seconds**, reading input and playing cues through
 *    an API that cannot draw.
 * 3. **`render` receives the prepared context**, so the game draws in logical
 *    coordinates and letterboxing simply does not appear in its code — through an
 *    API that cannot read input or play a cue, which is what leaves a frame's
 *    audible and observable behaviour entirely to the update.
 * 4. **After `render`** the transform is reset and the overlay is drawn in device
 *    space, so debug text stays the same physical size however far the game's own
 *    coordinates are being scaled, and the input frame is closed so an
 *    edge-triggered action is consumed exactly once.
 *
 * @throws if the design size is not finite and positive, if the canvas yields no 2D
 * context, or if `layout` is outside the catalogue. Each otherwise presents as a
 * build that runs and draws nothing, which is the most expensive kind of failure to
 * trace, so each is refused where it happens.
 */
export function createEngine<S, D = unknown>(
  options: EngineOptions<S, D>,
): Engine<S, D> {
  const { canvas, width, height, game } = options;

  if (!isDesignSize(width) || !isDesignSize(height)) {
    throw new Error(
      `createEngine needs a finite, positive logical design size, got ${width}x${height}`,
    );
  }

  const rawCtx = canvas.getContext("2d");
  if (rawCtx === null) {
    throw new Error(
      "createEngine could not get a 2D context from the canvas; the engine renders through it",
    );
  }

  // Everything drawn as part of a frame goes through the recorder's wrapper: the
  // engine's own frame preparation as well as the game's render, because the clear
  // and the viewport transform are part of the picture a replay has to reproduce.
  // The wrapper is built once and never swapped, so a game that holds on to the
  // context it was handed on its first frame keeps drawing through the same object
  // the recorder watches.
  const recorder = new ContextRecorder(rawCtx);
  const ctx = recorder.context;

  // Read once and held: the surface is the engine's only window onto the element,
  // and re-deriving it per frame would let a build be measured through one object
  // and listened to through another.
  const surface: SurfaceMetrics = options.surface ?? domSurface(canvas);
  const target = surface.events();

  // First, so `engine.events` is subscribable the instant the engine exists and no
  // subsystem below can be built holding a reference to a bus that is not the one a
  // caller will subscribe to.
  const bus = new EventBus();
  const emit = <K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void => bus.emit(event, payload);

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

  const audioContext = sharedAudioContext();
  // `assetRoot` is passed through rather than defaulted here: the loader owns the
  // convention, and a second copy of `"assets/"` in this file is a second place for
  // it to be changed in.
  const assets = new AssetLoader({
    root: options.assetRoot,
    emit,
    audioContext,
  });
  const audio = new AudioBus({
    emit,
    // Frame time rather than wall time, so a cue's `t` lines up with the
    // `frame().timeMs` a check asserts against. Frames stepped through `advance`
    // run back to back with no real time between them, and a wall stamp would put
    // every cue of a several-hundred-frame advance at the same instant.
    now: (): number => loop.info().timeMs,
    // Through the loader, so a file-backed cue obeys the asset root, the path
    // rules, and the `asset:loaded` / `asset:failed` events like any other asset.
    loadAudio: (path: string): Promise<AudioBuffer> => assets.loadAudio(path),
    audioContext,
  });
  const diagnostics = new Diagnostics();

  /**
   * The state and debug surface the game built, or `null` before it has built
   * them.
   *
   * A box rather than bare `S | null` and `D | null` slots, because either may
   * perfectly well *be* `null`: a game whose state is a single mutable object and
   * whose surface is `null` is the common case, but a game is entitled to any two
   * types it likes, and "has it been built" must not be answered by inspecting
   * the values. One box for both, because they arrive together — the pair
   * `initialize` returned — and there is no moment at which one exists without
   * the other.
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
      throw new Error("simple-2d: a frame ran before the game's state was built");
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

  /** Resize, clear, and transform, in that order — the frame's blank page. */
  const prepare = (): void => {
    viewport = syncCanvas(canvas, width, height, surface);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (options.background === undefined) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    applyViewport(ctx, viewport);
  };

  // The three scoped APIs are built once and reused for the life of the engine,
  // rather than per frame: they are stateless views onto the subsystems, a frame
  // that allocated three objects and eight closures would do so sixty times a
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
      loadImage: (path): Promise<ImageBitmap> => assets.loadImage(path),
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
      pointerPressed: (button): boolean => pointer.pressed(button),
      pointerReleased: (button): boolean => pointer.released(button),
      pointerSamples: () => pointer.samples(),
      pointerContacts: () => pointer.contacts(),
      wheel: () => pointer.wheel(),
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
    ctx,
    frame: (): FrameInfo => loop.info(),
    viewport: snapshot,
  };

  /**
   * The game, as the loop drives it.
   *
   * `prepare` runs at the top of the update rather than as a separate step because
   * the loop knows only about two callbacks and a set of after-frame hooks: the
   * canvas work has to happen inside the frame and before the game touches the
   * context, and wrapping is what keeps the loop ignorant of the canvas entirely.
   *
   * Both read the box through `frameBuilt`, which cannot fail here — no frame
   * runs before `initialize` resolves — but which keeps the invariant stated at the
   * point that depends on it instead of leaving a non-null assertion behind. The
   * update's return value is the state the frame leaves: `render` draws it, and
   * the next frame receives it.
   */
  const callbacks: FrameCallbacks = {
    update: (dt: number): void => {
      // The frame opens before `prepare`, so the clear and the viewport transform
      // are recorded as part of it and a replayed frame starts from the same blank
      // page the original did.
      recorder.beginFrame();
      prepare();
      const box = frameBuilt();
      transition(
        box,
        game.update(box.state as DeepReadonly<S>, updateApi, dt),
        "the game's update",
      );
    },
    // The prepared context is `renderApi.ctx`, the same object the loop would hand
    // over, so the argument is left unnamed rather than shadowing it.
    render: (): void => {
      game.render(frameBuilt().state as DeepReadonly<S>, renderApi);
      // Closed here rather than in the loop's after-frame hook, so the diagnostics
      // overlay drawn there stays out of the recording: the overlay is chrome laid
      // over the finished picture, and baking a debug panel into a reviewer's
      // evidence would misreport what the build drew.
      const info = loop.info();
      recorder.endFrame(
        { count: info.count, timeMs: info.timeMs, deltaMs: info.lastDeltaMs },
        { width: canvas.width, height: canvas.height },
      );
    },
  };

  const loop = new FrameLoop({
    clock: options.clock ?? new WallClock(),
    callbacks,
    context: (): CanvasRenderingContext2D => rawCtx,
  });

  // Late-wired, because the overlay and the loop each need the other: the loop's
  // frames are what there is to time, and the overlay is what reports the timing.
  diagnostics.timings = {
    metrics: () => loop.metrics(),
    series: () => loop.series(),
  };

  loop.onFrame(() => {
    // Identity transform: the overlay is chrome laid over the finished picture, not
    // part of it, so it is measured and drawn in device pixels rather than being
    // scaled — and letterboxed — along with the game's own coordinates.
    rawCtx.setTransform(1, 0, 0, 1, 0, 0);
    diagnostics.draw(rawCtx, canvas.width, canvas.height);
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
     * Read the registered diagnostics, off the engine rather than off the panel.
     *
     * Registration is the game's part and drawing the overlay is the engine's, so
     * a check that wants to know what the game named reads here instead of
     * inspecting what the panel drew.
     */
    diagnostics: (): readonly DiagnosticReading[] => diagnostics.read(),

    recording: (): boolean => recorder.active,

    /**
     * Arm the recorder, so the frames from here on are captured.
     *
     * Capture begins at the next frame rather than part-way through the current
     * one. A recorder armed from inside an `update` would otherwise open a frame
     * whose clear and viewport transform had already happened, and replaying that
     * frame would draw the game's own operations onto whatever the player's canvas
     * already held.
     *
     * A second call while already recording is refused rather than silently
     * discarding what has been captured: the mistake is always an unbalanced
     * `stopRecording`, and a caller told about it loses nothing, while a caller
     * handed an empty recording has lost the frames its check was about.
     */
    startRecording(): void {
      if (recorder.active) {
        throw new Error(
          "engine.startRecording() was called while already recording: call engine.stopRecording() first",
        );
      }
      recorder.start({
        width,
        height,
        background: options.background ?? null,
      });
    },

    /**
     * Disarm the recorder and hand back what it captured.
     *
     * Refuses when nothing is being recorded, for the same reason `startRecording`
     * refuses a second arming: an empty recording returned from an unbalanced call
     * reads as "the build drew nothing", which is a claim about the build rather
     * than about the caller.
     */
    stopRecording(): Recording {
      if (!recorder.active) {
        throw new Error(
          "engine.stopRecording() was called while not recording: call engine.startRecording() first",
        );
      }
      return recorder.stop();
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
     * The audio bus is silenced in between: a looping cue would otherwise outlive
     * the engine that started it, sounding on a page whose game is gone. Silencing
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
      bus.clear();
    },
  };
}

export { ConstantClock, JitterClock, PacedClock, SequenceClock, WallClock } from "./clocks";
export type { PacedClockOptions } from "./clocks";
export { TOUCH_LAYOUTS } from "./layouts";
export { RECORDING_FORMAT } from "./recording";
export { applyViewport, fitViewport, syncCanvas } from "./viewport";

/**
 * The whole shared vocabulary, re-exported wholesale.
 *
 * `contract.ts` *is* the package's type surface — it exists precisely so that the
 * engine, the game-facing API, and the recording format cannot drift apart — and
 * re-exporting it as a list would add a fourth place for a type to be forgotten in.
 * The contract module holds no runtime values, so nothing but types crosses.
 */
export type * from "./contract";
