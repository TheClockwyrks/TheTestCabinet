/**
 * The vocabulary shared by the engine's subsystems, by the game-facing API, and
 * by the events it publishes.
 *
 * These types are declared once, here, rather than beside the subsystem that owns
 * each one, because almost every one of them is spoken by more than one side of
 * the package. Keeping the declarations in a leaf module with no value imports means the
 * entry points cannot drift apart, and that `@test-cabinet/simple-2d` can be
 * consumed for its types alone without pulling in the DOM-bound engine.
 */

// The one import, and a type: `DeepReadonly` from `ts-essentials` is the view
// every reader of a game's state is handed. The engine holds the state as the
// game's own `S`; nothing but the transition that produced it — `update`, or a
// transition a caller applies through {@link Engine.apply} — ever sees it
// writable. Re-exported so a game that wants the same view of its own state
// names it without a second import.
import type { DeepReadonly } from "ts-essentials";

export type { DeepReadonly };

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
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every value a diagnostic source may report.
 *
 * Three types, and the set is closed: the overlay draws one line per source, and a
 * reader of that line wants the presentation a `string` fixes, the magnitude a
 * `number` carries, or the flag a `boolean` states. A value the game holds in some
 * other shape is reduced to one of the three inside the source, which is where the
 * game's own vocabulary lives. Closing the set is also what lets a check compare a
 * reading against an expected value without narrowing it first.
 */
export type DiagnosticValue = string | number | boolean;

/**
 * One registered diagnostic and what it reports right now.
 *
 * Exactly one of `value` and `error` is present. A source that throws yields
 * `error` and no `value`, which keeps a failure distinguishable from every reading
 * a working source could produce: were the message reported as the value, a defect
 * in the game's source would arrive as a well-typed `string` that a check comparing
 * values could accept.
 */
export interface DiagnosticReading {
  /** The name the source was registered under. */
  readonly name: string;
  /** What the source reported, when it returned. */
  readonly value?: DiagnosticValue;
  /** Why the source failed, when it threw. */
  readonly error?: string;
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

/**
 * The kind of device driving a pointer.
 *
 * A game reads it where it wants to differ between them, sizing a hit area for
 * a fingertip or naming a button rather than a tap, and otherwise ignores it:
 * all three arrive on the same reads.
 */
export type PointerDevice = "mouse" | "pen" | "touch";

/**
 * A button on a pointing device.
 *
 * A pen or a touch in contact holds `primary`, which is what lets a game
 * written against the primary button alone play identically on all three
 * devices.
 */
export type PointerButton =
  | "primary"
  | "secondary"
  | "auxiliary"
  | "back"
  | "forward";

/**
 * What one pointer sample reports the pointer doing.
 *
 * The three describe the pointer's *contact*: a `down` is the pointer coming
 * into contact, an `up` is it leaving, and a `move` is everything else it did,
 * a change of position or a change of which buttons it holds. Per pointer,
 * `down` and `up` therefore alternate strictly.
 */
export type PointerSampleType = "down" | "move" | "up";

/**
 * One pointer sample: what happened, where, and which pointer did it, in the
 * game's logical coordinates.
 *
 * Samples are the per-position record a game that reacts to the path the
 * pointer traveled reads: a sweep that crossed several targets between two
 * frames arrives as the ordered positions it visited rather than as the last
 * one alone.
 */
export interface PointerSample {
  /** What the pointer did. */
  readonly type: PointerSampleType;
  /** The logical x the sample landed at. */
  readonly x: number;
  /** The logical y the sample landed at. */
  readonly y: number;
  /** The pointer this sample came from. */
  readonly id: number;
  /** Whether it came from the primary pointer, the one the snapshot follows. */
  readonly primary: boolean;
  /** The device that drove it. */
  readonly device: PointerDevice;
  /** The button whose state it reports, or `null` when it reports movement. */
  readonly button: PointerButton | null;
  /** Every button held once the sample has been applied. */
  readonly buttons: readonly PointerButton[];
}

/**
 * The primary pointer as a frame reads it: the most recent position, in the
 * game's logical coordinates, whether it is held, the device that last drove
 * it, and the buttons it holds.
 *
 * Before the first pointer event the position is `(0, 0)`, `down` is `false`,
 * `device` is `"mouse"`, and `buttons` is empty. A point inside a letterbox bar
 * maps outside `0..width` or `0..height`, so a game clamps it or treats it as a
 * miss.
 */
export interface PointerSnapshot {
  /** The most recent logical x. */
  x: number;
  /** The most recent logical y. */
  y: number;
  /** Whether the pointer holds at least one button. */
  down: boolean;
  /** The device that last drove the pointer. */
  device: PointerDevice;
  /** The buttons currently held. */
  buttons: PointerButton[];
}

/**
 * One pointer in contact with the surface.
 *
 * The contact list is what a pinch, a two-finger drag, or two players on one
 * screen read. A game driving one thing with one pointer reads the snapshot
 * instead, which follows the primary pointer alone.
 */
export interface PointerContact {
  /** The pointer's id, which its samples carry. */
  readonly id: number;
  /** The most recent logical x. */
  readonly x: number;
  /** The most recent logical y. */
  readonly y: number;
  /** Whether this is the primary pointer. */
  readonly primary: boolean;
  /** The device driving it. */
  readonly device: PointerDevice;
  /** The buttons it holds. */
  readonly buttons: readonly PointerButton[];
}

/**
 * Wheel travel over one input frame, in the game's logical units, positive
 * rightward and downward.
 */
export interface WheelDelta {
  /** Horizontal travel. */
  readonly x: number;
  /** Vertical travel. */
  readonly y: number;
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
  /** The starting frequency in hertz. A loop holds it. */
  freq: number;
  /**
   * The frequency to sweep to over the cue's duration; absent holds `freq`. A
   * loop ignores it.
   */
  freqTo?: number;
  /** Peak gain in `[0, 1]`; defaults to the engine's cue gain. A loop holds it. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. A loop ignores it. */
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
  /** A cue started looping. `t` is frame-loop time; `gain` is `0` while muted. */
  "cue:looped": { cue: string; t: number; gain: number };
  /** A looping cue stopped. `t` is frame-loop time. */
  "cue:stopped": { cue: string; t: number };
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
  /** The target key and pointer events are listened for on. */
  events(): EventTarget;
  /**
   * The canvas's top-left corner in the client coordinate space pointer events
   * report their positions in — what the engine subtracts before mapping a
   * pointer position onto the stage. Absent, the origin reads `(0, 0)`, so a
   * dispatched pointer event's client position is read as CSS pixels from the
   * canvas's corner.
   */
  origin?(): { x: number; y: number };
  /**
   * Takes the browser's own pointer gestures on the surface, and returns the
   * function that gives them back.
   *
   * Those gestures are panning, pinch-zoom, double-tap zoom, text selection,
   * the wheel's page scroll, and the context menu. Claimed, a drag, a wheel,
   * and a press of the secondary button reach the game instead of the page,
   * which is what makes touch and the secondary button usable at all. The
   * engine claims them as the pointer attaches and gives them back when it
   * detaches. A surface with no element behind it owns no gestures and omits
   * this.
   */
  claimGestures?(): () => void;
  /**
   * Routes every later event for `pointerId` to the surface, so a drag that
   * leaves the element keeps delivering moves and its release is seen. The
   * engine captures each pointer as it comes into contact.
   */
  capturePointer?(pointerId: number): void;
  /** Ends the capture `capturePointer` began. */
  releasePointerCapture?(pointerId: number): void;
}

/* -------------------------------------------------------------------------- */
/* The scoped APIs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a game may reach while it initializes.
 *
 * Generic over the game's state so a diagnostic source can be typed against it:
 * the source is handed the state current at the moment the overlay reads it,
 * because the state a frame leaves behind is a new value rather than the object
 * `initialize` built, and a source that closed over that first object would
 * report the title screen forever.
 */
export interface InitApi<S = unknown> {
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
    /**
     * Name a value for the overlay. The source is called on every read, with the
     * state current at that read.
     */
    register(
      name: string,
      source: (state: DeepReadonly<S>) => DiagnosticValue,
    ): void;
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
    /** The primary pointer's position, hold, device, and buttons, as a copy. */
    pointer(): PointerSnapshot;
    /** Whether `button` was pressed since the last frame; `"primary"` by default. */
    pointerPressed(button?: PointerButton): boolean;
    /** Whether `button` was released since the last frame; `"primary"` by default. */
    pointerReleased(button?: PointerButton): boolean;
    /**
     * The samples every pointer delivered since the input frame last closed, in
     * arrival order, as a fresh copy. Reading does not consume the list.
     */
    pointerSamples(): PointerSample[];
    /** Every pointer in contact, in the order they came into contact. */
    pointerContacts(): PointerContact[];
    /** The wheel travel accumulated since the input frame last closed. */
    wheel(): WheelDelta;
  };
  readonly audio: {
    /** Play a defined cue. */
    play(cue: string): void;
    /** Start a defined cue looping. Nothing happens if it already is. */
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
 * returns. Every frame is a transition over it: `update` is handed the current
 * state as a {@link DeepReadonly} view and returns the next state, and `render`
 * is handed that next state, as the same read-only view, and returns nothing.
 * The state is the only channel between the three, so everything a frame needs
 * is reachable from a value the type system already checked — and because no
 * reader ever holds a writable reference, "rendering does not change the state"
 * and "nothing but the update advances the simulation" are facts the compiler
 * checks rather than comments.
 *
 * `D` is the game's debug surface, the second element of that pair and the value
 * {@link Engine.debug} returns unchanged. The engine holds it and reads no member
 * of it, so its shape belongs to the game. A game with no surface writes
 * `Game<State, null>` and returns `[state, null]`. Because the surface cannot
 * hold a writable state either, its operations are written in the shape of
 * `update`: a pose takes the current state and returns the next, a reading takes
 * the current state and returns what it read, and a caller drives them through
 * {@link Engine.apply} and {@link Engine.state}.
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
  initialize(api: InitApi<S>): [S, D] | Promise<[S, D]>;
  /**
   * Advance the simulation by `dt` seconds: the next state, from the current one.
   *
   * The value returned is the state the frame leaves behind — what `render`
   * draws, what {@link Engine.state} reads, and what the next `update` receives.
   * Returning `undefined` is refused, because a game that forgot to return has
   * not advanced anything.
   */
  update(state: DeepReadonly<S>, api: UpdateApi, dt: number): S;
  /** Draw the state the update left behind. */
  render(state: DeepReadonly<S>, api: RenderApi): void;
}

/**
 * A change to the state made from outside a frame.
 *
 * The shape `update` has, minus the frame: the current state in, the next state
 * out. It is what a debug surface's poses are written as, and what a caller
 * hands {@link Engine.apply}.
 */
export type Transition<S> = (state: DeepReadonly<S>) => S;

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
  /**
   * The current state, as a read-only view. Throws before `initialize` resolves.
   *
   * "Current" rather than "live": each frame replaces the value, so a reader
   * reads the state the most recent transition left and holds nothing a later
   * frame writes to.
   */
  readonly state: DeepReadonly<S>;
  /**
   * The debug surface the game's `initialize` returned beside its state, live.
   * Throws before `initialize` has resolved.
   *
   * Returned exactly as the game handed it over, so a caller reads the shape the
   * game declared rather than one the engine imposed.
   */
  readonly debug: D;
  /** Run the game's `initialize` and resolve to the state it produced. */
  initialize(): Promise<DeepReadonly<S>>;
  /**
   * Replace the state with the one `transition` returns from the current one,
   * and return the new state. How a caller poses a game between frames: the
   * next frame's `update` receives the state this left. Throws before
   * `initialize` resolves, and refuses a transition that returns `undefined`.
   */
  apply(transition: Transition<S>): DeepReadonly<S>;
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
  /**
   * Every registered diagnostic and what it reports now, in registration order.
   *
   * Evaluates each source against the current state and changes nothing else, so
   * a check reads the sources a build registered without posing the overlay: the
   * reading is the same whether the panel is drawn or hidden.
   */
  diagnostics(): readonly DiagnosticReading[];
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
