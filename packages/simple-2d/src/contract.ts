/**
 * The vocabulary shared by the engine's subsystems, by the game-facing API, and
 * by the events it publishes.
 *
 * These types are declared once, here, rather than beside the subsystem that owns
 * each one, because almost every one of them is spoken by more than one side of
 * the package. Keeping the declarations in a leaf module with no imports means the
 * entry points cannot drift apart, and that `@test-cabinet/simple-2d` can be
 * consumed for its types alone without pulling in the DOM-bound engine.
 */

/* -------------------------------------------------------------------------- */
/* Clocks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The source of a frame's delta time.
 *
 * A clock answers one question: how much time is this frame worth. Returning
 * `null` declines the tick, which leaves the simulation and the frame counter
 * untouched and is how a clock paces below the rate its ticks arrive at.
 *
 * Nothing here distinguishes a clock that drives itself from one that is stepped.
 * That is a property of the caller's entry point — {@link Engine.run} or
 * {@link Engine.advance} — so a clock that ignores `nowMs` yields the same
 * sequence of deltas under both.
 */
export interface Clock {
  /** This tick's delta in milliseconds, or `null` when the tick is not a frame. */
  delta(nowMs: number): number | null;
}

/* -------------------------------------------------------------------------- */
/* Frame                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The frame loop's position.
 *
 * `count` is the tick unit a check asserts against; `timeMs` is the accumulated
 * simulated time, which is the sum of the deltas delivered rather than elapsed
 * wall time; `lastDeltaMs` is what the most recent frame was stepped by.
 */
export interface FrameInfo {
  /** Frames run since the loop started. */
  count: number;
  /** Total simulated time in milliseconds. */
  timeMs: number;
  /** The delta the most recent frame was stepped by, in milliseconds. */
  lastDeltaMs: number;
}

/**
 * Frame timing over the recent past, as the overlay reports it.
 *
 * The window is a duration rather than a frame count so the figures mean the same
 * thing at every frame rate. A run at 30 frames per second and one at 240 both
 * report the last ten seconds.
 */
export interface FrameMetrics {
  /** Frames inside the window. */
  samples: number;
  /** Mean frame time in milliseconds. */
  meanMs: number;
  /** 95th percentile frame time in milliseconds. */
  p95Ms: number;
  /** 99th percentile frame time in milliseconds. */
  p99Ms: number;
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether an action reports a continuous magnitude or a plain on/off.
 *
 * An `analog` action is sampled every frame for its value; a `digital` action is
 * usually consumed as an edge. Declaring the kind lets the engine decide what a
 * keyboard binding means for that action.
 */
export type ActionKind = "digital" | "analog";

/**
 * What a game supplies when it registers an action.
 *
 * `keys` are `KeyboardEvent.code` values rather than `key` values, so a binding is
 * layout-independent: `KeyW` is the same physical key on QWERTY and AZERTY.
 */
export interface ActionBinding {
  /** The `KeyboardEvent.code` values that drive this action. */
  keys: string[];
  /** How the action is interpreted; defaults to `"digital"`. */
  kind?: ActionKind;
}

/** An action as the engine holds it, with every default resolved. */
export interface RegisteredAction {
  /** The action's name, as the game registered it. */
  name: string;
  /** The resolved `KeyboardEvent.code` bindings. */
  keys: string[];
  /** The resolved kind. */
  kind: ActionKind;
  /** The touch layout this action belongs to, or `null` for one beyond its vocabulary. */
  layout: string | null;
}

/**
 * A touch layout: the name of a control scheme and the action vocabulary it
 * brings with it.
 *
 * Selection is declarative. It tags the actions the game registers rather than
 * drawing controls or registering anything, so a reader can establish which
 * vocabulary is live as a static fact.
 */
export interface TouchLayout {
  /** The layout's name. */
  name: string;
  /** The action names the layout provides, including the universal menu actions. */
  actions: string[];
}

/* -------------------------------------------------------------------------- */
/* Audio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The synthesis description behind a named audio cue.
 *
 * Keeping the description this small covers the bleeps a 2D game needs without a
 * game shipping audio assets or touching Web Audio. A game wanting a recorded
 * sound loads a produced audio file under the same name instead.
 */
export interface CueSpec {
  /** The oscillator waveform; defaults to a sine. */
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  /** The starting frequency in hertz. */
  freq: number;
  /** The frequency to sweep to over the cue's duration; absent holds `freq`. */
  freqTo?: number;
  /** Peak gain in `[0, 1]`; defaults to the engine's cue gain. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. */
  durationMs: number;
}

/**
 * The audio bus's two observable bits.
 *
 * `unlocked` is separate from `muted` because browsers refuse to start an audio
 * context before a user gesture. A silent game may be silent because the player
 * muted it or because nothing has been touched yet.
 */
export interface AudioState {
  /** Whether the bus is muted. */
  muted: boolean;
  /** Whether a user gesture has unlocked the audio context. */
  unlocked: boolean;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** The events the engine broadcasts, by name, with the payload each carries. */
export interface EngineEventMap {
  /** An asset arrived. */
  "asset:loaded": { path: string; url: string };
  /** An asset was refused or failed to arrive. */
  "asset:failed": { path: string; url: string; reason: string };
  /** A cue played. `t` is frame-loop time; `gain` is `0` while muted. */
  "cue:played": { cue: string; t: number; gain: number };
  /** A user gesture unlocked the audio context. */
  "audio:unlocked": Record<string, never>;
}

/**
 * Subscription to the engine's events.
 *
 * Handlers are called synchronously at the moment the event happens, so a
 * subscriber observes the frame the event belongs to. This is what replaces an
 * accumulating record: a subscriber keeps exactly what it needs, and the engine
 * holds nothing that grows with the length of a run.
 */
export interface EngineEvents {
  /** Subscribe to `event`. Returns the function that removes the handler. */
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

/* -------------------------------------------------------------------------- */
/* Viewport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The map from a game's logical design size onto a canvas's backing store.
 *
 * `scale` and the offsets are in device pixels, with the device pixel ratio
 * folded into `scale`. A logical point therefore maps to device space as
 * `offsetX + x * scale`, which is the arithmetic a check sampling pixels repeats.
 */
export interface Viewport {
  /** The logical design width; a game draws in `0..width`. */
  readonly width: number;
  /** The logical design height; a game draws in `0..height`. */
  readonly height: number;
  /** Device pixels per logical unit. */
  scale: number;
  /** The left letterbox bar, in device pixels. */
  offsetX: number;
  /** The top letterbox bar, in device pixels. */
  offsetY: number;
}

/**
 * Where the engine reads the drawing surface's size and pixel density, and what
 * it attaches its key listeners to.
 *
 * Every measurement the engine would otherwise take from the DOM passes through
 * here, which is what lets the engine run over a canvas with no document behind
 * it.
 */
export interface SurfaceMetrics {
  /** The element's laid-out width in CSS pixels. */
  cssWidth(): number;
  /** The element's laid-out height in CSS pixels. */
  cssHeight(): number;
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The target key events are listened for on. */
  events(): EventTarget;
}

/* -------------------------------------------------------------------------- */
/* The scoped APIs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a game may reach while it initializes.
 */
export interface InitApi {
  readonly input: {
    /** Register or re-register an action. */
    register(name: string, binding: ActionBinding): void;
    /** The selected touch layout and its vocabulary. */
    layout(): TouchLayout | null;
  };
  readonly audio: {
    /** Declare a synthesized cue under a name. */
    define(cue: string, spec: CueSpec): void;
    /** Back a cue with a produced audio file under the asset root. */
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    /** Load an image under the asset root. */
    loadImage(path: string): Promise<ImageBitmap>;
    /** Load and decode an audio file under the asset root. */
    loadAudio(path: string): Promise<AudioBuffer>;
    /** Load any asset under the asset root. */
    load(path: string): Promise<Blob>;
    /** The URL a path resolves to, without loading it. */
    resolve(path: string): string;
  };
  readonly diagnostics: {
    /** Name a value for the overlay. The source is called on every read. */
    register(name: string, source: () => unknown): void;
  };
  readonly events: EngineEvents;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/**
 * What a game may reach while it updates.
 *
 * Nothing here draws, which is what lets a simulation be stepped and inspected
 * with no drawing surface taking part in the result.
 */
export interface UpdateApi {
  readonly input: {
    /** The action's current magnitude. */
    value(name: string): number;
    /** Whether the action was pressed since the last frame. */
    pressed(name: string): boolean;
  };
  readonly audio: {
    /** Play a defined cue. */
    play(cue: string): void;
    /** Mute or unmute the bus. */
    setMuted(muted: boolean): void;
    /** Whether the bus is muted. */
    muted(): boolean;
  };
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/**
 * What a game may reach while it renders.
 *
 * Nothing here reads input or plays a cue, so a frame's audible and observable
 * behavior is decided entirely by the update.
 */
export interface RenderApi {
  /** The destination, cleared and already carrying the logical viewport transform. */
  readonly ctx: CanvasRenderingContext2D;
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* The game                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The three functions and the two types a game supplies.
 *
 * `S` is the game's own state, the first element of the pair `initialize`
 * returns and the value handed back to every `update` and `render`. It is the
 * only channel between the three, so everything a frame needs is reachable from
 * a value the type system already checked.
 *
 * `D` is the game's debug surface, the second element of that pair and the value
 * {@link Engine.debug} returns unchanged. The engine holds it and reads no member
 * of it, so its shape belongs to the game. A game with no surface writes
 * `Game<State, null>` and returns `[state, null]`.
 *
 * Because both are built in one go during initialization and no frame runs
 * before that resolves, the state has no not-yet-loaded fields for a frame to
 * branch on and the surface is in place before any caller can reach for it.
 */
export interface Game<S, D = unknown> {
  /**
   * Declare the game's bindings, cues and diagnostics, and build its state and
   * its debug surface, returned together as `[state, debug]`.
   */
  initialize(api: InitApi): [S, D] | Promise<[S, D]>;
  /** Advance the simulation by `dt` seconds. */
  update(state: S, api: UpdateApi, dt: number): void;
  /** Draw the state the update left behind. */
  render(state: S, api: RenderApi): void;
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A value carried inside a recorded operation.
 *
 * Plain data travels as itself. `$res` names an entry of {@link Recording.resources}
 * — a value the context produced, carried as the recipe that rebuilds it — and
 * `$img` names an entry of {@link Recording.images}. Both tables belong to the whole
 * recording rather than to any one frame, which is what lets a fill established on
 * the first frame resolve when the thousandth is drawn by itself. `$opaque` names a
 * value the recorder could not carry, so a player reports the operation it cannot
 * reproduce instead of drawing something else.
 *
 * `{ $opaque: "truncated" }` is the one marker that stands for more than one value:
 * a recorder expands what a build passed to a bound, and everything past that bound
 * is refused as a single marker rather than as one marker per value. Replacing each
 * element of a half-million-element array with its own marker costs seconds and
 * produces a document larger than the data it declined to carry.
 */
export type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $res: number }
  | { readonly $img: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };

/**
 * One operation the context itself performed.
 *
 * An operation performed *on* a value the context returned is not one of these: it
 * belongs to that value's {@link Resource} recipe. So a player issues every
 * operation it reads against the context it is drawing into, and never has to ask
 * what a given one is being applied to.
 */
export type DrawOp =
  | {
      readonly op: "call";
      readonly method: string;
      readonly args: readonly DrawValue[];
    }
  | {
      readonly op: "set";
      readonly property: string;
      readonly value: DrawValue;
    };

/**
 * One mutation applied to a value the context produced.
 *
 * The same two shapes an operation takes, because a mutation is a call or an
 * assignment like any other. What differs is what it applies to, and the
 * {@link Resource} that holds it already names that.
 */
export type ResourceOp = DrawOp;

/**
 * A bitmap or a pixel buffer an operation draws.
 *
 * A sprite-based build spends most of its operations on `drawImage`, so the sources
 * those calls read from are part of the picture rather than something beside it. A
 * `bitmap` is carried as a PNG data URL, which is the one form both a browser and
 * the native canvas a validator runs against rebuild an image from.
 *
 * A `pixels` entry carries its bytes instead, because the canvas round trip a PNG
 * needs is lossy: drawing an image into a canvas premultiplies each colour channel
 * by the pixel's alpha and reading the pixels back un-premultiplies them, so a
 * partially transparent pixel is quantized to eight bits twice and comes back a
 * different colour. `ImageData` is the one kind of image a check compares byte for
 * byte, so it travels byte for byte and is rebuilt with no decoder at all.
 */
export type CapturedImage =
  | {
      /** How the value is rebuilt: as an image a context can draw. */
      readonly kind: "bitmap";
      /** The captured width in pixels. */
      readonly width: number;
      /** The captured height in pixels. */
      readonly height: number;
      /** A `data:image/png;base64,…` URL holding the pixels. */
      readonly src: string;
    }
  | {
      /** How the value is rebuilt: as `ImageData`. */
      readonly kind: "pixels";
      /** The captured width in pixels. */
      readonly width: number;
      /** The captured height in pixels. */
      readonly height: number;
      /** The RGBA bytes, base64 encoded, four bytes per pixel in row order. */
      readonly data: string;
    };

/**
 * A value the context produced, carried as the recipe that rebuilds it.
 *
 * The recipe is taken at the moment the value is *used*, and holds the mutations
 * applied to it up to that point. A gradient that is filled, given another colour
 * stop, and filled again paints differently the second time, so the two fills name
 * two resources and a replay paints each under the stops it actually had.
 *
 * A style property holds a live reference, so a value given another mutation after
 * it was assigned paints under that mutation without ever being assigned again. The
 * recorder therefore records a corrective assignment before the paint, and the
 * recipe a painting operation draws under is the one the context would paint with.
 *
 * `make.args` are as of the *producing* call rather than as of the use, because
 * `createPattern` copies its source when it is called: a pattern made from a
 * scratch canvas keeps the picture that canvas carried at that moment.
 */
export interface Resource {
  /** The context call that created the value. */
  readonly make: {
    readonly method: string;
    readonly args: readonly DrawValue[];
  };
  /** The calls and assignments made on it before this use, in order. */
  readonly then: readonly ResourceOp[];
}

/**
 * The context state a frame inherited from the frame before it.
 *
 * Recording it is what makes a frame independently renderable: a game that sets a
 * font once relies on the context still carrying it much later, and a player that
 * seeks straight to a frame has no earlier frame to have inherited it from.
 */
export interface DrawState {
  /** The style properties in force, by name. */
  readonly properties: Readonly<Record<string, DrawValue>>;
  /** The transform as `[a, b, c, d, e, f]`, or `null` when unreadable. */
  readonly transform: readonly number[] | null;
  /** The dash pattern, or `null` when unreadable. */
  readonly lineDash: readonly number[] | null;
  /** The clip in force, as the segments that built it, in the order they applied. */
  readonly clip: readonly PathSegment[];
  /**
   * The current path, as the segments holding the operations issued since the last
   * `beginPath`.
   *
   * A canvas keeps its current path across a frame boundary, so a build is free to
   * open a path on one frame and fill it on the next. Carrying it is also what makes
   * an inherited clip safe: replaying a clip segment's path operations leaves the
   * clip outline current, so a state that stopped at the clip would leave a bare
   * `fill` among the frame's operations filling that outline. A player issues
   * `beginPath` between the clip segments and these.
   */
  readonly path: readonly PathSegment[];
}

/**
 * One run of path operations the context issued under one transform.
 *
 * A canvas reports neither the clip region in force nor the current path, so both
 * are carried as the operations that built them. Clips intersect rather than
 * replace, so a state holds every segment applied so far and a player applies them
 * in turn. Each segment carries the transform its operations were issued under,
 * because a path is given in user space and replaying it under the frame's own
 * transform would clip, or draw, a different region.
 */
export interface PathSegment {
  /** The transform in force when these operations were issued, or `null` when unreadable. */
  readonly transform: readonly number[] | null;
  /** The path operations issued under that transform, in order. */
  readonly ops: readonly DrawOp[];
}

/** One frame of a recording. */
export interface RecordedFrame {
  /** The engine's frame counter at this frame. */
  readonly count: number;
  /** Accumulated simulated time through this frame, in milliseconds. */
  readonly timeMs: number;
  /** What this frame was worth, in milliseconds. */
  readonly deltaMs: number;
  /** The canvas backing store this frame was drawn into, in device pixels. */
  readonly surface: { readonly width: number; readonly height: number };
  /** Index into {@link Recording.states} of the state this frame inherited. */
  readonly state: number;
  /**
   * Indices into {@link Recording.states} of the states saved under this frame,
   * outermost first.
   *
   * A build may `save` on one frame and `restore` on the next, so the stack of
   * saved states survives a frame boundary along with the state on top of it. A
   * player pushes these before applying the frame's own state, which is what makes
   * a `restore` among the frame's operations return where the original returned.
   *
   * At most 64 entries, and the entries kept are the innermost, because a `restore`
   * pops the innermost first. The bound is what keeps a build that saves more often
   * than it restores from costing a longer stack at every frame open for the rest of
   * a recording.
   */
  readonly stack: readonly number[];
  /** Indices into {@link Recording.ops}, in the order the frame issued them. */
  readonly ops: readonly number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound.
   *
   * The save stack, the clip region and the current path are each shadowed by the
   * recorder and each bounded, because a build that saves without restoring, or
   * that never calls `beginPath`, would otherwise cost more at every frame open for
   * the rest of the recording. Past a bound the recorder keeps what it already has
   * and refuses the rest, so the frame replays under a state that is close to the
   * build's rather than equal to it.
   *
   * A reviewer has to be able to tell a picture the format could not carry from one
   * it carried, so a frame that was cut down says so and a player reports it beside
   * everything else it could not reproduce. Present only when something was in fact
   * cut down: the flag names an exceptional frame, and writing `false` on every
   * frame of a fifty-thousand-frame recording would cost bytes to say nothing.
   */
  readonly truncated?: boolean;
}

/**
 * A recorded run of frames.
 *
 * Every frame stands alone, so a player may draw any frame without drawing the
 * ones before it. That is what lets two recordings be scrubbed together in step.
 *
 * The four tables in front of the frames are shared by the whole recording, and
 * each holds every distinct entry once. Consecutive frames of a game issue very
 * nearly the same operations under very nearly the same state, so naming an entry
 * by index is what bounds both what a recording costs to store and what a
 * reviewer's browser pays to parse and hold it.
 */
export interface Recording {
  /** The format version a player checks before drawing anything. */
  readonly format: number;
  /** The logical design width the operations were issued in. */
  readonly width: number;
  /** The logical design height the operations were issued in. */
  readonly height: number;
  /** The colour each frame was cleared to, or `null` for transparency. */
  readonly background: string | null;
  /** The bitmaps and pixel buffers the operations draw, by index. */
  readonly images: readonly CapturedImage[];
  /** The values the context produced and the operations draw with, by index. */
  readonly resources: readonly Resource[];
  /** Every distinct operation the recording holds, by index. */
  readonly ops: readonly DrawOp[];
  /** Every distinct inherited state block, by index. */
  readonly states: readonly DrawState[];
  /** The frames captured, in order. */
  readonly frames: readonly RecordedFrame[];
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

/** What a game hands `createEngine`. */
export interface EngineOptions<S, D = unknown> {
  /** The canvas the engine sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game draws in. */
  width: number;
  /** The logical design height the game draws in. */
  height: number;
  /** The game this engine drives, bound for the engine's lifetime. */
  game: Game<S, D>;
  /** A CSS color cleared to before every frame; absent clears to transparency. */
  background?: string;
  /** A touch layout from the catalogue, whose vocabulary the game then registers. */
  layout?: string;
  /** The clock supplying each frame's delta; defaults to a wall clock. */
  clock?: Clock;
  /** Where the engine reads element size and pixel density. */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under; defaults to `"assets/"`. */
  assetRoot?: string;
}

/** How a run halts. */
export interface RunOptions {
  /** Aborting this halts the loop and resolves the promise `run` returned. */
  signal?: AbortSignal;
}

/**
 * The engine, as a build holds it.
 *
 * Construction runs no game code, so a caller may replace the clock and subscribe
 * to {@link Engine.events} before anything the game does is observable.
 */
export interface Engine<S, D = unknown> {
  /** Subscribe to engine events. Available from construction. */
  readonly events: EngineEvents;
  /** The value `initialize` resolved to, live. Throws before then. */
  readonly state: S;
  /**
   * The debug surface the game's `initialize` returned beside its state, live.
   * Throws before `initialize` has resolved.
   *
   * Returned exactly as the game handed it over, so a caller reads the shape the
   * game declared rather than one the engine imposed.
   */
  readonly debug: D;
  /** Run the game's `initialize` and resolve to the state it produced. */
  initialize(): Promise<S>;
  /** Drive the game off the host's frame callback until the signal aborts. */
  run(options?: RunOptions): Promise<void>;
  /** Tick the clock `frames` times, running a frame for each tick it accepts. */
  advance(frames: number): Promise<void>;
  /** Replace the clock. The next frame takes its delta from the new one. */
  setClock(clock: Clock): void;
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** Whether draw-command recording is currently capturing. */
  recording(): boolean;
  /**
   * Begin capturing draw commands. Capture starts at the next frame, so a caller
   * that arms the recorder from inside a frame records whole frames only.
   */
  startRecording(): void;
  /** Stop capturing and hand back everything captured since `startRecording`. */
  stopRecording(): Recording;
  /** Halt the loop and drop every listener. */
  destroy(): void;
}
