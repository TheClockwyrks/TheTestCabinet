/**
 * `@test-cabinet/simple-3d` — the **Simple 3D** engine: the runtime a produced 3D
 * game is built on, and the wiring that assembles it.
 *
 * The package has one entry point, this module, and it is what a game and a
 * validator both import. `three` is a peer dependency: a build declares it itself
 * and imports it directly wherever it needs a three object, so the engine, the
 * build, and `@test-cabinet/voxel-runtime/three` share one instance. The engine
 * re-exports nothing from `three`.
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
 * - **The two surfaces** — a `THREE.WebGLRenderer` over the canvas with the
 *   retained scene and the camera it draws through, and a second, engine-owned 2D
 *   canvas — the *screen layer* — composited over that picture, so a HUD is text
 *   and rectangles on the design field rather than camera-facing geometry.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, with edge detection done once and correctly, and
 *   a pointer mapped into the game's own logical coordinates.
 * - **Audio** — cues played by name, synthesized or file-backed, placed in the
 *   world and heard from the camera, and the first-gesture unlock a browser
 *   insists on.
 * - **Assets** — resolution and loading under one fixed root, textures and glTF
 *   models included.
 * - **Diagnostics** — an overlay of values the game names, its frame-time graph
 *   beside the renderer's draw counts, and the key that toggles it.
 * - **Recording** — an opt-in flight recorder over the picture the game submitted,
 *   encoded as a VP9 WebM video timestamped in simulated time.
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
 * and in what order a frame's steps happen. Four of those decisions are worth
 * stating up front, because a game and a validator both depend on them:
 *
 * 1. **Construction runs no game code.** {@link createEngine} validates, builds, and
 *    returns. The game's own `initialize` runs later, from
 *    {@link Engine.initialize}, which is what lets a caller subscribe to
 *    {@link Engine.events} first and observe the game's loading as it happens
 *    instead of inferring it afterwards. The scene and the camera exist from
 *    construction for the same reason: both are engine-owned objects, so a caller
 *    may watch what the game's own initialization puts in the scene.
 * 2. **Observation is by event.** Nothing here accumulates a log of what a run did.
 *    A subscriber keeps exactly what it decided was worth keeping, and the engine's
 *    footprint is the same after a million frames as after one.
 * 3. **Every measurement goes through a {@link SurfaceMetrics}.** The element's
 *    size, the device pixel ratio, and the target the key listeners go on all
 *    arrive through that one seam, so the same engine runs over a canvas in a page
 *    and over a native canvas with no document behind it.
 * 4. **A frame's eleven steps happen in one stated order**, written out at
 *    {@link createEngine} below. Three consequences of that order are contracts in
 *    their own right: the camera the game posed in its `render` is the camera the
 *    {@link View} answers from afterwards, so the next frame's `update` picks
 *    against the camera the player is looking through; the recorder captures
 *    between the scene render and the overlay, so a recording holds the picture the
 *    game submitted and nothing of the overlay; and the input frame closes last, so
 *    an edge armed during a frame is news for exactly that frame.
 *
 * The game owns its simulation and its picture: an `initialize` that returns the
 * state and the debug surface, an `update` that takes the state and a delta and
 * returns the next state, and a `render` that populates the scene, poses the
 * camera, and draws the screen layer.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 1280, height: 720, game });
 * await engine.initialize();
 * await engine.run({ signal: controller.signal });
 * ```
 */

import type * as THREE from "three";
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
  Model,
  Recording,
  RenderApi,
  RunOptions,
  SurfaceMetrics,
  Transition,
  UpdateApi,
  View,
  Viewport,
} from "./contract";
import { Diagnostics, rendererCounts } from "./diagnostics";
import { EventBus } from "./events";
import type { FrameCallbacks } from "./frame";
import { FrameLoop } from "./frame";
import { InputRegistry } from "./input";
import { PointerInput } from "./pointer";
import { FrameRecorder } from "./recording";
import { createRenderStage } from "./rendering";
import { createView } from "./view";
import { applyViewport, domSurface, syncCanvas } from "./viewport";

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
 * runs from {@link Engine.initialize} and the first frame from {@link Engine.run}
 * or {@link Engine.advance}, so an engine exists — subscribable, with its clock
 * replaceable, its scene and its camera readable — before anything the game does is
 * observable.
 *
 * The per-frame order is the engine's real contribution, and it is what a game gets
 * for free. The eleven steps, in the order they happen:
 *
 * 1. **The clock is called once.** A declined tick ends the frame, so nothing below
 *    runs and no counter moves.
 * 2. **The counters advance** — the frame count, the accumulated simulated time, and
 *    the delta this frame is worth.
 * 3. **Both canvases are synced** to the surface's size and ratio and the viewport
 *    is recomputed. Doing this every frame rather than from a `resize` handler is
 *    what makes the fit correct on first paint, after a window resize, after a
 *    device-pixel-ratio change, and after a layout change no `resize` event fires
 *    for — with no handler at all, and no chance of the first frame drawing into a
 *    canvas that was never sized.
 * 4. **The screen layer is cleared and given the viewport transform**, so the HUD
 *    starts from a transparent field in logical coordinates and letterboxing simply
 *    does not appear in the game's code.
 * 5. **`update` runs with `dt` in seconds**, reading input and playing cues through
 *    an API that cannot draw, and the state is replaced with what it returned.
 * 6. **`render` runs**, populating the scene, posing the camera, and drawing the
 *    screen layer — through an API that cannot read input or play a cue, which is
 *    what leaves a frame's audible and observable behaviour entirely to the update.
 * 7. **The engine draws the picture**: world matrices updated, the camera read into
 *    the {@link View}, the whole canvas cleared to `background`, the letterboxed
 *    viewport and scissor applied, and the scene rendered through the camera. The
 *    listener follows that same reading, so a game poses the ear by posing the eye.
 * 8. **The recorder captures the frame** — after the picture exists and before any
 *    chrome is laid over it.
 * 9. **The diagnostics overlay draws** on the screen layer in device space, so debug
 *    text stays the same physical size however far the game's own coordinates are
 *    being scaled.
 * 10. **The screen layer is composited** over the picture as a full-canvas quad, so
 *     wherever the layer is transparent the scene shows through.
 * 11. **The input frame closes**, so an edge-triggered action is consumed exactly
 *     once.
 *
 * @throws if the design size is not finite and positive, if the canvas yields no
 * `webgl2` context, if there is no screen canvas and no document to make one from,
 * if `projection` is outside the pair, or if `layout` is outside the catalogue.
 * Each otherwise presents as a build that runs and draws nothing, which is the most
 * expensive kind of failure to trace, so each is refused where it happens.
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

  // The renderer, the scene, the camera, and the screen layer, and with them every
  // remaining construction failure the picture can have: no `webgl2` context, no
  // screen canvas and no document to create one from, a projection outside the pair.
  // Built before anything that attaches a listener, so a refusal here leaves nothing
  // of the engine behind on the page.
  const stage = createRenderStage(options);

  // Read once and held: the surface is the engine's only window onto the element,
  // and re-deriving it per frame would let a build be measured through one object
  // and listened to through another.
  const surface: SurfaceMetrics = options.surface ?? domSurface(canvas);
  const target = surface.events();

  // First among the subsystems, so `engine.events` is subscribable the instant the
  // engine exists and no subsystem below can be built holding a reference to a bus
  // that is not the one a caller will subscribe to.
  const bus = new EventBus();
  const emit = <K extends keyof EngineEventMap>(
    event: K,
    payload: EngineEventMap[K],
  ): void => bus.emit(event, payload);

  const input = new InputRegistry(surface);
  try {
    if (options.layout !== undefined) input.useLayout(options.layout);
  } catch (error) {
    // The registry attached its key listeners at construction and the stage holds a
    // GL context, and a refused layout means no engine is returned to undo either
    // with. Both are given back before rethrowing, so a rejected build leaves the
    // page — and the browser's context budget — exactly as it found them.
    input.detach();
    stage.dispose();
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
   * perfectly well *be* `null`: a game whose state is a plain record and whose
   * surface is `null` is the common case, but a game is entitled to any two
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
      throw new Error("simple-3d: a frame ran before the game's state was built");
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
  // real fit rather than a zero one before the first frame runs. The screen canvas
  // follows the stage canvas rather than the surface, so it is synced after — a
  // stage the fit has just resized would otherwise leave the two a frame apart.
  let viewport = syncCanvas(canvas, width, height, surface);
  stage.syncScreen();

  // After the layout gate above: a refused layout detaches the key listeners and
  // rethrows, and constructing the pointer past that point means there is never a
  // moment where its listeners exist with no engine to detach them.
  const pointer = new PointerInput(surface, () => viewport);

  /**
   * The camera as it stood at the most recent render, and the one call that
   * advances that reading.
   *
   * Built straight out of the stage, before any game code has run, so its seed
   * reading is the documented camera defaults: a validator that poses
   * `engine.camera` and then reads `engine.view()` without advancing a frame is
   * told the defaults, because a pose reaches the view when the frame that drew
   * with it ends rather than when it is written.
   */
  const viewReader = createView(stage.camera, width, height);

  const recorder = new FrameRecorder(canvas, stage.screenCanvas);

  /** The fit as a caller owns it — a copy, so holding one observes no later frame. */
  const snapshot = (): Viewport => ({
    width: viewport.width,
    height: viewport.height,
    scale: viewport.scale,
    offsetX: viewport.offsetX,
    offsetY: viewport.offsetY,
  });

  /**
   * Steps 3 and 4: resize both canvases, then blank the screen layer and point it
   * at the logical field.
   *
   * The screen layer is *cleared*, never filled, whatever `background` says. The
   * background belongs to the canvas the scene is drawn on and is applied in step 7;
   * a screen layer filled with it would be an opaque sheet drawn over the picture at
   * the end of the frame, and the game would appear to render nothing at all.
   */
  const prepare = (): void => {
    viewport = syncCanvas(canvas, width, height, surface);
    stage.syncScreen();

    const { screen, screenCanvas } = stage;
    // Identity first, so the clear covers the whole backing store rather than only
    // the letterboxed rectangle the previous frame's transform mapped.
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
    applyViewport(screen, viewport);
  };

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
      loadImage: (path): Promise<ImageBitmap> => assets.loadImage(path),
      loadTexture: (path): Promise<THREE.Texture> => assets.loadTexture(path),
      loadModel: (path): Promise<Model> => assets.loadModel(path),
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
    // The engine's own scene, so what a game places while it initializes — its
    // lights, its static geometry, the models it just loaded — is still there when
    // the first `render` runs.
    scene: stage.scene,
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
      play: (cue, playOptions): void => audio.play(cue, playOptions),
      loop: (cue, playOptions): void => audio.loop(cue, playOptions),
      stop: (cue): void => audio.stop(cue),
      place: (cue, at): void => audio.place(cue, at),
      looping: (cue): boolean => audio.looping(cue),
      setMuted: (muted): void => audio.setMuted(muted),
      muted: (): boolean => audio.muted(),
    },
    frame: (): FrameInfo => loop.info(),
    viewport: snapshot,
    // The reading taken at the end of the *previous* frame, which is the camera the
    // player is currently looking through: a pick resolved here is resolved against
    // the picture on the screen rather than against one nothing has drawn yet.
    view: (): View => viewReader.view,
  };

  const renderApi: RenderApi = {
    scene: stage.scene,
    camera: stage.camera,
    screen: stage.screen,
    frame: (): FrameInfo => loop.info(),
    viewport: snapshot,
    // The same reading the update saw, and for the same reason: the engine takes
    // its next one after `render` returns, so a world point projected from here
    // lands where the previous frame's camera placed it — which is this frame's
    // place too whenever the camera is still.
    view: (): View => viewReader.view,
  };

  /**
   * The game, as the loop drives it.
   *
   * `prepare` runs at the top of the update rather than as a separate step because
   * the loop knows only about two callbacks and a set of after-frame hooks: the
   * canvas work has to happen inside the frame and before the game touches either
   * surface, and wrapping is what keeps the loop ignorant of the canvases entirely.
   *
   * Both read the box through `frameBuilt`, which cannot fail here — no frame
   * runs before `initialize` resolves — but which keeps the invariant stated at the
   * point that depends on it instead of leaving a non-null assertion behind. The
   * update's return value is the state the frame leaves: `render` draws it, and
   * the next frame receives it.
   */
  const callbacks: FrameCallbacks = {
    update: (dt: number): void => {
      prepare();
      const box = frameBuilt();
      transition(
        box,
        game.update(box.state as DeepReadonly<S>, updateApi, dt),
        "the game's update",
      );
    },
    render: (): void => {
      game.render(frameBuilt().state as DeepReadonly<S>, renderApi);

      // Step 7. The world matrices come up to date first, so the reading taken from
      // the camera is the pose the picture is about to be drawn through and a world
      // position read off an object is where it stood this frame.
      stage.updateWorld();
      viewReader.read();
      stage.render(viewport);

      // The listener follows the same reading the view answers from, every frame:
      // a cue placed at a fixed world point moves across the stereo field as the
      // camera turns, and a game poses the ear by posing the eye.
      audio.listen(viewReader.view.camera());

      // Step 8, and it is *here* rather than in the after-frame hook for the reason
      // the recorder's contract is stated in: the overlay is chrome laid over the
      // finished picture, and baking a debug panel into a reviewer's evidence would
      // misreport what the build drew.
      recorder.capture(loop.info());
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
  // The stage's snapshot rather than the renderer's live counters. Three resets
  // `renderer.info` at the top of every `render` call and the engine makes two per
  // frame — the scene, then the quad that composites the screen layer — so a panel
  // reading the renderer would report the composite's one draw call for every frame
  // however much the game submitted.
  diagnostics.counts = rendererCounts(stage);

  loop.onFrame(() => {
    // Steps 9 and 10. Identity transform: the overlay is chrome laid over the
    // finished picture, not part of it, so it is measured and drawn in device pixels
    // rather than being scaled — and letterboxed — along with the game's own
    // coordinates. The composite then lifts the whole layer, overlay included, onto
    // the canvas over the 3D picture.
    stage.screen.setTransform(1, 0, 0, 1, 0, 0);
    diagnostics.draw(
      stage.screen,
      stage.screenCanvas.width,
      stage.screenCanvas.height,
    );
    stage.composite();

    // Step 11, last, so an edge armed during this frame was available to the game's
    // update and is gone before the next one: a press is news for exactly one frame.
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
     * The scene and the camera, live and engine-owned.
     *
     * Both are the objects themselves rather than copies, and both are readable from
     * construction, which is what lets a validator find an object by name, read its
     * world position, and read the camera's pose with no pixels involved — before
     * the first frame, after any number of them, and after the engine is destroyed.
     */
    scene: stage.scene,
    camera: stage.camera,

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
     * The camera as it stood at the most recent render, with picking and projection
     * through it.
     *
     * The reader's own view object rather than a copy of it, because every answer it
     * gives is already a fresh value: a caller holding it holds a stable seam onto
     * the latest reading, and nothing it hands back is written by a later frame.
     */
    view: (): View => viewReader.view,

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
     * one, because the recorder composes a frame from two canvases and a frame
     * armed part-way through has only half of one to compose. The loop's current
     * frame counter is what fixes that boundary: reached from between frames it is
     * the frame that just finished, and reached from inside the game's `update` or
     * `render` it is the frame in flight — either way the recording begins at the
     * first frame past it.
     *
     * The size the recording is encoded at is fixed here, and the unbalanced-call
     * and no-WebCodecs refusals are the recorder's own, so the invariant holds
     * however the recorder is driven.
     */
    startRecording(): void {
      recorder.start(loop.info().count);
    },

    /**
     * Disarm the recorder, flush the encoder, and hand back what it captured.
     *
     * The refusal for an unbalanced call is thrown rather than returned as a
     * rejection, at the call where the mistake is: a caller that did not `await` the
     * promise would otherwise never hear about it. Everything past that refusal is
     * asynchronous, because the last frames are still inside the encoder and the
     * container cannot be closed until their bytes are out of it.
     */
    stopRecording(): Promise<Recording> {
      return recorder.stop();
    },

    /**
     * Halt the loop, drop every listener, and dispose the renderer.
     *
     * Idempotent, because teardown races: a page unload, an explicit call, and a
     * test's `afterEach` all reach here, and only the first one has anything to do.
     *
     * The loop is halted first, so nothing can emit into a bus that is about to be
     * cleared, and the subscriptions go last: a handler typically closes over the
     * caller's own scene, and leaving the bus subscribed after teardown keeps that
     * scope alive and lets a stale handler observe a successor engine's events.
     *
     * In between, the audio bus is silenced — a looping cue would otherwise outlive
     * the engine that started it, sounding on a page whose game is gone — an armed
     * capture is discarded rather than finished, since its frames were evidence for
     * a check that is no longer running, and the renderer is disposed. The scene and
     * the objects the game placed in it are left as they stand, so a caller that
     * reads the scene after destroying the engine still finds what the last frame
     * left.
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
      recorder.discard();
      stage.dispose();
      bus.clear();
    },
  };
}

export { cloneModel } from "./assets";
export { ConstantClock, JitterClock, PacedClock, SequenceClock, WallClock } from "./clocks";
export { TOUCH_LAYOUTS } from "./input";
export { applyViewport, fitViewport, syncCanvas } from "./viewport";

/**
 * The whole shared vocabulary, re-exported wholesale.
 *
 * `contract.ts` *is* the package's type surface — it exists precisely so that the
 * engine, the game-facing API, and the recording format cannot drift apart — and
 * re-exporting it as a list would add a second place for a type to be forgotten in.
 * `PacedClockOptions` rides along with it rather than coming from `clocks.ts`,
 * because in this engine the clock options are part of that one contract. The
 * contract module holds no runtime values, so nothing but types crosses.
 */
export type * from "./contract";
