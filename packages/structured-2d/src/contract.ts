/**
 * The vocabulary shared by the engine's subsystems, by the framework classes a
 * game subclasses, and by the events the engine publishes.
 *
 * These types are declared once, here, rather than beside the subsystem that
 * owns each one, because almost every one of them is spoken by more than one
 * side of the package: the engine hands a `World` to a game mode and to a
 * validator alike, the event map is emitted by four subsystems and subscribed to
 * from one seam, and the recording format is written by the recorder and read by
 * a player that never imports the engine. Keeping the declarations in a module
 * with no *value* imports means the entry points cannot drift apart. The class
 * references below (`Actor`, `GameMode`, …) are type-only imports of the
 * framework classes, which erase at runtime, so this module stays a leaf.
 *
 * Everything here mirrors the API pages under
 * `docs/engines/structured-2d/apis/` — those pages are the specification, and a
 * type that disagrees with its page is wrong.
 */

import type { Actor, Pawn } from "./actors";
import type { ColliderComponent } from "./collision";
import type { Component } from "./components";
import type { Controller, PlayerController } from "./controllers";
import type { GameInstance } from "./game-instance";
import type { GameMode, GameState } from "./game-mode";

/* -------------------------------------------------------------------------- */
/* Clocks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The source of a frame's delta time.
 *
 * A clock answers one question: how much simulated time is this frame worth, in
 * milliseconds. Returning `null` declines the tick, which leaves the simulation
 * and the frame counter untouched and is how a clock paces below the rate its
 * ticks arrive at.
 *
 * Nothing here distinguishes a clock that drives itself from one that is
 * stepped. That is a property of the caller's entry point — {@link Engine.run}
 * or {@link Engine.advance} — so a clock that ignores `nowMs` yields the same
 * sequence of deltas under both, which is what lets a validator step a scenario
 * synchronously and a reviewer watch the same scenario play.
 */
export interface Clock {
  /**
   * This tick's delta in milliseconds, or `null` when the tick is not a frame.
   * `nowMs` is the host timestamp on the same time base as `performance.now`.
   */
  delta(nowMs: number): number | null;
}

/* -------------------------------------------------------------------------- */
/* Frame                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The frame loop's position: `engine.frame()`, `world.frame()`, and a
 * `DrawComponent`'s `api.frame()` all return it.
 *
 * The counter and the accumulated time belong to the loop rather than the
 * world, so both carry across a level transition; `timeMs` is the sum of the
 * deltas delivered, which diverges from wall time whenever the host stops
 * delivering frames or a clock supplies its own deltas.
 */
export interface FrameInfo {
  /** Frames delivered since the loop started. */
  count: number;
  /** Accumulated simulated time, in milliseconds. */
  timeMs: number;
  /** The most recent frame's delta, in milliseconds. */
  lastDeltaMs: number;
}

/**
 * Frame timing over the recent past, as the diagnostics overlay reports it.
 *
 * The window is the last 10 seconds of frames measured against *simulated*
 * time, held in a ring buffer capped at 2048 samples. Percentiles are
 * nearest-rank over the window sorted ascending; an empty window reports `0`
 * for all three figures.
 */
export interface FrameMetrics {
  /** How many frames the window holds. */
  samples: number;
  /** The arithmetic mean of the window's samples, in milliseconds. */
  meanMs: number;
  /** The 95th percentile of the window's samples, in milliseconds. */
  p95Ms: number;
  /** The 99th percentile of the window's samples, in milliseconds. */
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
 * `number` carries, or the flag a `boolean` states. A framework object such as an
 * actor is reduced to one of the three inside the source, which is where the game's
 * own vocabulary lives. Closing the set is also what lets a check compare a reading
 * against an expected value without narrowing it first.
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
/* Geometry, camera, and viewport                                             */
/* -------------------------------------------------------------------------- */

/** A point or a direction, in the units of whatever names it. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * An axis-aligned rectangle, placed by `x`/`y` and sized by `width`/`height`,
 * in the units of whatever names it.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The camera's projection at one moment, as a plain value the caller owns.
 *
 * `camera.snapshot()` returns one, and a `DrawComponent` reads one from
 * `api.camera()`. A held snapshot keeps the values of the frame it was read in.
 */
export interface CameraSnapshot {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

/**
 * The world's camera: the map from world units into the logical design size.
 *
 * A world's camera starts at `x = width / 2`, `y = height / 2`, `zoom = 1`,
 * `rotation = 0`, and `bounds = null`, so world coordinates and logical
 * coordinates coincide until the game moves it. The camera is part of the
 * world, reached as `world.camera`, and a level transition builds a new one at
 * those defaults.
 */
export interface Camera {
  /** The world x the center of the logical field shows. */
  x: number;
  /** The world y the center of the logical field shows. */
  y: number;
  /** Logical units per world unit. A zoom of `2` halves the visible extent. */
  zoom: number;
  /** Radians, turning the projected region about the camera's position. */
  rotation: number;
  /** A rectangle in world units the visible region is kept inside, or `null`. */
  bounds: Rect | null;
  /** The actor the camera follows, or `null`. */
  readonly target: Actor | null;
  /** Sets `target`. `null` clears it and returns the projection to the game. */
  follow(actor: Actor | null): void;
  /** The projection as a value the caller owns. */
  snapshot(): CameraSnapshot;
  /** A world point in logical coordinates, through position, zoom, and rotation. */
  worldToLogical(point: Vec2): Vec2;
  /** The inverse of {@link worldToLogical}. */
  logicalToWorld(point: Vec2): Vec2;
}

/**
 * The affine map from the logical design size onto the canvas's backing store.
 *
 * `scale` and both offsets are *device* pixels — the device pixel ratio is
 * folded into `scale`, so the CSS-pixel figure is `scale` divided by the ratio.
 * Every read (`engine.viewport()`, `world.viewport()`, `InitApi.viewport()`,
 * `DrawApi.viewport()`) returns a snapshot the caller owns.
 */
export interface Viewport {
  /** The logical design width. */
  readonly width: number;
  /** The logical design height. */
  readonly height: number;
  /** Device pixels per logical unit, with the device pixel ratio folded in. */
  scale: number;
  /** The left letterbox bar, in device pixels. */
  offsetX: number;
  /** The top letterbox bar, in device pixels. */
  offsetY: number;
}

/* -------------------------------------------------------------------------- */
/* Surface                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where the engine reads element size and device pixel ratio, and where its key
 * and pointer listeners attach.
 *
 * Supplied, it replaces every measurement the engine would otherwise take from
 * the DOM, which is what lets the engine run over a canvas with no document
 * behind it. Absent, the engine reads the canvas's element size, its window's
 * device pixel ratio, its bounding rectangle for the origin, and listens on the
 * canvas's owning document.
 */
export interface SurfaceMetrics {
  /** The canvas's laid-out CSS width, measured on every call. */
  cssWidth(): number;
  /** The canvas's laid-out CSS height, measured on every call. */
  cssHeight(): number;
  /** The device pixel ratio in force for the canvas. */
  dpr(): number;
  /** The target the engine's key and pointer listeners attach to. */
  events(): EventTarget;
  /**
   * The canvas's top-left corner in the client coordinate space pointer events
   * report their positions in — what the engine subtracts before mapping a
   * pointer onto the stage. Absent, the origin reads `(0, 0)`, so a dispatched
   * pointer event's client position is read as CSS pixels from the canvas's
   * corner.
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
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** How a magnitude reaching an action is reported. */
export type ActionKind = "digital" | "analog";

/**
 * What a game supplies when it registers an action.
 *
 * `keys` are `KeyboardEvent.code` values rather than `key` values, so a binding
 * is layout-independent: `KeyW` is the same physical key on QWERTY and AZERTY.
 */
export interface ActionBinding {
  /** The `KeyboardEvent.code` values that drive the action. */
  keys: string[];
  /** How a magnitude reaching the action is reported. Defaults to `"digital"`. */
  kind?: ActionKind;
}

/**
 * The resolved form of a registration: the binding with its defaults filled in
 * and its layout provenance attached.
 */
export interface RegisteredAction {
  /** The name the action was registered under. */
  name: string;
  /** The bound codes, as a copy. */
  keys: string[];
  /** The resolved kind, always present. */
  kind: ActionKind;
  /**
   * The touch layout the action belongs to, or `null` when the selected
   * layout's vocabulary omits the name.
   */
  layout: string | null;
}

/** One entry of the touch-layout catalogue. */
export interface TouchLayout {
  name: string;
  /** The layout's own vocabulary followed by the four menu actions. */
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
 * What kind of pointer sample a frame delivered.
 *
 * The three describe the pointer's contact: a `down` is the pointer coming into
 * contact, an `up` is it leaving, and a `move` is everything else it did, a
 * change of position or a change of which buttons it holds. Per pointer, `down`
 * and `up` therefore alternate strictly.
 */
export type PointerSampleType = "down" | "move" | "up";

/** One pointer sample, in the engine's logical design coordinates. */
export interface PointerSample {
  readonly type: PointerSampleType;
  readonly x: number;
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
 * The primary pointer's most recent position, hold state, device, and held
 * buttons, as a fresh copy. Before the first pointer event the position is
 * `(0, 0)`, `down` is `false`, `device` is `"mouse"`, and `buttons` is empty.
 */
export interface PointerSnapshot {
  x: number;
  y: number;
  down: boolean;
  device: PointerDevice;
  buttons: PointerButton[];
}

/**
 * One pointer in contact with the surface.
 *
 * The contact list is what a pinch, a two-finger drag, or two players on one
 * screen read. A controller driving one thing with one pointer reads the
 * snapshot instead, which follows the primary pointer alone.
 */
export interface PointerContact {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly primary: boolean;
  readonly device: PointerDevice;
  readonly buttons: readonly PointerButton[];
}

/**
 * Wheel travel over one input frame, in logical design units, positive
 * rightward and downward.
 */
export interface WheelDelta {
  readonly x: number;
  readonly y: number;
}

/**
 * The one place a game reads its actions, reached as
 * `PlayerController.input`.
 *
 * Each player controller consumes edges independently: an armed edge is
 * `pressed` exactly once for each controller that asks, and within one
 * controller the first read consumes it. The engine closes the input frame
 * after the frame renders, discarding every edge left unconsumed, so a press is
 * news for exactly one frame.
 */
export interface InputReader {
  /**
   * The action's resolved magnitude: `0` or `1` for a `"digital"` action (every
   * non-zero magnitude quantized to `1`), the magnitude as given for an
   * `"analog"` one, and `0` for an unregistered name.
   */
  value(name: string): number;
  /**
   * `true` exactly once per armed edge per player controller; the call consumes
   * this controller's copy. `false` for an unregistered name.
   */
  pressed(name: string): boolean;
  /** The primary pointer's position, hold, device, and buttons, as a fresh copy. */
  pointer(): PointerSnapshot;
  /**
   * `true` exactly once per press edge of `button` per player controller;
   * consuming. `button` defaults to `"primary"`.
   */
  pointerPressed(button?: PointerButton): boolean;
  /**
   * `true` exactly once per release edge of `button` per player controller;
   * consuming. `button` defaults to `"primary"`.
   */
  pointerReleased(button?: PointerButton): boolean;
  /**
   * Every sample delivered since the input frame last closed, in arrival order,
   * as a fresh copy. Reading does not consume the list. At most 1024 samples
   * are listed per frame; a burst past that bound still moves the snapshot and
   * the edges.
   */
  pointerSamples(): PointerSample[];
  /** Every pointer in contact, in the order they came into contact, as a copy. */
  pointerContacts(): PointerContact[];
  /** The wheel travel accumulated since the input frame last closed, as a copy. */
  wheel(): WheelDelta;
}

/* -------------------------------------------------------------------------- */
/* Audio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A synthesized cue: an oscillator with a linear sweep and a decaying envelope.
 *
 * `durationMs` is milliseconds, where the delta time a `tick` receives is
 * seconds. A loop holds `freq` and `gain` and ignores `freqTo` and
 * `durationMs`.
 */
export interface CueSpec {
  /** The oscillator waveform. Defaults to `"sine"`. */
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  /** The starting frequency, in hertz. A loop holds it. */
  freq: number;
  /** The frequency swept to linearly across the duration. Defaults to `freq`. */
  freqTo?: number;
  /** The peak gain the envelope decays from, `0`–`1`. Defaults to `0.2`. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. */
  durationMs: number;
}

/** The audio bus's condition. */
export interface AudioState {
  /** Whether the bus is muted. */
  muted: boolean;
  /** Whether a user gesture has opened the audio context. */
  unlocked: boolean;
}

/**
 * The cue bus a world plays through, reached as `world.audio`.
 *
 * Cue definitions and running loops belong to the engine rather than the world,
 * so both survive a level transition. A muted cue still emits its event,
 * reporting `gain: 0`, and every running loop follows the mute bit live.
 */
export interface WorldAudio {
  /**
   * Emits `cue:played` and, when audible, sounds the cue. Returns immediately.
   * Throws for a cue that was never declared, naming the cue.
   */
  play(cue: string): void;
  /**
   * Starts the cue looping if it is not already, emitting `cue:looped` once.
   * Does nothing for a cue already looping. Throws for an undeclared cue.
   */
  loop(cue: string): void;
  /**
   * Stops the cue's loop if it is looping, emitting `cue:stopped` once. Does
   * nothing for a cue that is not looping. Throws for an undeclared cue.
   */
  stop(cue: string): void;
  /** Whether the cue is looping. `false` for an undeclared cue. */
  looping(cue: string): boolean;
  /** Sets the mute bit. Live: every running loop follows it. */
  setMuted(muted: boolean): void;
  /** The current mute bit. */
  muted(): boolean;
}

/* -------------------------------------------------------------------------- */
/* Shapes and collision                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A drawn shape and a collider's shape alike.
 *
 * A rect and a polygon are centered on the component's transform, and a
 * polygon's points are world units relative to it.
 */
export type Shape =
  | { kind: "rect"; width: number; height: number }
  | { kind: "circle"; radius: number }
  | { kind: "polygon"; points: readonly Vec2[] };

/**
 * How one collider answers a collider on a channel. A pair is evaluated in both
 * directions and takes the stronger of the two answers, ordered `ignore` below
 * `overlap` below `block`.
 */
export type CollisionResponse = "ignore" | "overlap" | "block";

/** What a `ColliderComponent` is constructed from. */
export interface ColliderOptions {
  /** The shape tested, in world units relative to the component's world transform. */
  shape: Shape;
  /** The channel this collider is on. Defaults to `"default"`. */
  channel?: string;
  /**
   * Maps a channel name to how this collider answers a collider on it. An
   * unlisted channel answers `"ignore"`. Defaults to empty.
   */
  responses?: Readonly<Record<string, CollisionResponse>>;
}

/**
 * How far apart a blocking pair is not.
 *
 * Oriented by the reported order of the pair: `normal` points from the first
 * collider toward the second, so the first is moved out of the second along
 * `-normal`. Multiplying `normal` by `depth` gives the smallest translation
 * that separates them.
 */
export interface Manifold {
  /** The unit direction separating the pair, first collider toward the second. */
  normal: Vec2;
  /** How far the two shapes penetrate along `normal`, in world units. */
  depth: number;
  /** A point on the shared boundary. */
  point: Vec2;
}

/** One collider a query found, with the actor that owns it. */
export interface Overlap {
  actor: Actor;
  collider: ColliderComponent;
}

/** One collider a ray met. */
export interface Hit {
  /** The actor the ray met. */
  actor: Actor;
  /** The collider on it the ray met. */
  collider: ColliderComponent;
  /** Where the ray meets the collider, in world units. */
  point: Vec2;
  /** The unit surface normal at `point`. */
  normal: Vec2;
  /** How far along the ray `point` lies, from `origin`. */
  distance: number;
}

/**
 * Puts a query on a channel and gives it a response map, so the query is
 * filtered by the same both-directions rule a pair of colliders is. A collider
 * the resolution leaves at `"ignore"` is left out of the result, and so is
 * every collider owned by an actor `ignore` names.
 */
export interface QueryOptions {
  channel?: string;
  responses?: Readonly<Record<string, CollisionResponse>>;
  ignore?: readonly Actor[];
}

/**
 * The world's collision queries, reached as `world.collision`.
 *
 * A query is answered from the colliders as they stand when it is called; the
 * three collision events belong to the frame's pass instead.
 */
export interface CollisionWorld {
  /** The colliders currently intersecting one of `actor`'s. */
  overlaps(actor: Actor): readonly Overlap[];
  /** The colliders `shape` intersects when it is placed at `at`. */
  query(shape: Shape, at: Vec2, options?: QueryOptions): readonly Overlap[];
  /**
   * The nearest hit along the ray, or `null`. `direction` is a unit vector and
   * `distance` bounds the ray's length, in world units.
   */
  raycast(
    origin: Vec2,
    direction: Vec2,
    distance: number,
    options?: QueryOptions,
  ): Hit | null;
  /** Every hit along the ray, in increasing `distance`. */
  raycastAll(
    origin: Vec2,
    direction: Vec2,
    distance: number,
    options?: QueryOptions,
  ): readonly Hit[];
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the pipeline draws each component as.
 *
 * The mode belongs to the pipeline and applies to every component it draws, so
 * every game has all four modes available: `shaded` is the full picture,
 * `wireframe` each outline alone at one stroke width, `unlit` fills and images
 * at full opacity with every tint dropped, and `silhouette` each component
 * filled flat in its layer's color.
 */
export type RenderMode = "shaded" | "wireframe" | "unlit" | "silhouette";

/**
 * The rendering pipeline's two switches, reached as `engine.renderer` and
 * available from construction.
 */
export interface Renderer {
  /** The mode in force, `shaded` until it is set. */
  mode(): RenderMode;
  /** Sets the mode. The next frame the pipeline runs draws under it. */
  setMode(mode: RenderMode): void;
  /** Whether the collision overlay draws. */
  collisionOverlay(): boolean;
  /**
   * Turns the collision overlay on or off. The overlay draws every enabled
   * collider's shape over the finished picture, in a color per response, and is
   * independent of the mode.
   */
  setCollisionOverlay(enabled: boolean): void;
}

/**
 * What a `DrawComponent`'s `draw` receives: the direct-drawing path, for a case
 * that measures the drawing itself.
 *
 * The context already carries the world-to-device transform, so the component
 * draws in world units. Render modes belong to the declarative pipeline, so a
 * `DrawComponent` reads `mode` and supplies its own.
 */
export interface DrawApi {
  /** The 2D context, already carrying the world-to-device transform. */
  readonly ctx: CanvasRenderingContext2D;
  /** The render mode in force for this frame. */
  readonly mode: RenderMode;
  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** The camera's position, zoom, and rotation for this frame. */
  camera(): CameraSnapshot;
}

/* -------------------------------------------------------------------------- */
/* Components (options)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The type `actor.component` and `actor.componentsOf` select by. A component is
 * constructed with whatever arguments its own class takes, then handed to
 * `actor.attach`.
 */
export type ComponentClass<C extends Component = Component> = new (
  ...args: never[]
) => C;

/** What a `SpriteComponent` is constructed from. */
export interface SpriteOptions {
  /** The decoded bitmap the component draws. */
  image: ImageBitmap;
  /** A region of a sprite sheet. Absent, the whole image is drawn. */
  source?: Rect;
  /** The drawn width, in world units. Defaults to the source region's pixel width. */
  width?: number;
  /** The drawn height, in world units. Defaults to the source region's pixel height. */
  height?: number;
  /** The horizontal anchor, as a fraction of the drawn size. Defaults to `0.5`. */
  anchorX?: number;
  /** The vertical anchor, as a fraction of the drawn size. Defaults to `0.5`. */
  anchorY?: number;
  /** A CSS color the image is tinted with. Absent, no tint. */
  tint?: string;
}

/** What a `ShapeComponent` is constructed from. */
export interface ShapeOptions {
  /** The geometry drawn. */
  shape: Shape;
  /** A CSS color filled inside the shape. Absent, no fill. */
  fill?: string;
  /** A CSS color stroked around the outline. Absent, no stroke. */
  stroke?: string;
  /** The stroke width, in world units. Defaults to `1`. */
  strokeWidth?: number;
}

/** What a `TextComponent` is constructed from. */
export interface TextOptions {
  /** The string drawn. */
  text: string;
  /** A CSS font shorthand. Defaults to `"16px sans-serif"`; size is world units. */
  font?: string;
  /** The fill color. Defaults to `"#ffffff"`. */
  fill?: string;
  /** Horizontal alignment against the component's transform. Defaults to `"center"`. */
  align?: "left" | "center" | "right";
  /** Vertical alignment against the component's transform. Defaults to `"middle"`. */
  baseline?: "top" | "middle" | "bottom";
}

/* -------------------------------------------------------------------------- */
/* Actors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An actor class takes no constructor arguments: the world constructs it and
 * then applies the spec it was spawned from.
 */
export type ActorClass<A extends Actor = Actor> = new () => A;

/**
 * An actor's own position, rotation, and scale, in world units.
 *
 * `rotation` is radians, clockwise, with `0` pointing along `+x`. A
 * `Partial<Transform>` on an `ActorSpec` or a `SpawnSpec` fills its absent
 * fields from the defaults `{ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }`.
 */
export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Why a lifecycle is ending: `"destroyed"` for an actor and its components
 * ending play because the actor was destroyed (and for a component removed by
 * `detach`); `"level-closed"` for every controller, actor, component, and game
 * mode ending play because the world is closing.
 */
export type EndPlayReason = "destroyed" | "level-closed";

/* -------------------------------------------------------------------------- */
/* Controllers                                                                */
/* -------------------------------------------------------------------------- */

/** A controller class takes no constructor arguments. */
export type ControllerClass<C extends Controller = Controller> = new () => C;

/* -------------------------------------------------------------------------- */
/* Game mode                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A game mode class takes no constructor arguments; `world`, `options`, and
 * `state` are assigned before `beginPlay` runs.
 */
export type GameModeClass = new () => GameMode;

/**
 * Where a match stands: `"waiting"` while it is being set up (the phase a mode
 * holds when it begins play), `"playing"` while it runs (`GameState.elapsed`
 * accumulates only here), and `"over"` once it is decided. The phase changes
 * only through `setPhase`.
 */
export type MatchPhase = "waiting" | "playing" | "over";

/** What `GameMode.addPlayer` takes. */
export interface PlayerOptions {
  /** The index the player state carries. Absent, the next free index. */
  index?: number;
  /** The name written onto the player state. */
  name?: string;
  /** The controller class to build. Absent, `playerControllerClass`. */
  controller?: ControllerClass<PlayerController>;
  /**
   * The pawn class to spawn and possess, in place of `pawnClass`. `null` adds a
   * controller that possesses nothing.
   */
  pawn?: ActorClass<Pawn> | null;
}

/**
 * What `GameMode.addBot` takes. `addBot` takes the controller class as its
 * first argument, so `BotOptions` names no controller; a bot's player state
 * carries the next free index and sits in `state.players` alongside a player's.
 */
export interface BotOptions {
  /** The name written onto the bot's player state. */
  name?: string;
  /**
   * The pawn class to spawn and possess, in place of `pawnClass`. `null` adds a
   * controller that possesses nothing.
   */
  pawn?: ActorClass<Pawn> | null;
}

/* -------------------------------------------------------------------------- */
/* Worlds and levels                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A level is a description rather than a live object: the game mode that runs
 * it, the actors placed in it, and the assets it loads. Opening one builds a
 * world, and the definition stays available for every later transition back to
 * it.
 */
export interface LevelDefinition {
  /** The game mode class constructed when the world is built. */
  mode: GameModeClass;
  /** The actors the level places, spawned in the order given. */
  actors?: readonly ActorSpec[];
  /**
   * Runs before the world is built, and is awaited — where the level's assets
   * and cues are loaded, so a component receives its image as a plain value.
   */
  load?(api: LoadApi): void | Promise<void>;
}

/**
 * One actor a level places. Every actor a level declares exists before any of
 * their `beginPlay` runs, so an actor finds its peers there rather than in
 * `configure`.
 */
export interface ActorSpec<A extends Actor = Actor> {
  /** The actor class constructed. */
  type: ActorClass<A>;
  /** Written over the constructed actor's transform, field by field. */
  transform?: Partial<Transform>;
  /** Tags carried by the actor from the moment it is attached. */
  tags?: readonly string[];
  /**
   * Runs on the constructed actor after the transform and the tags are
   * applied, before it begins play.
   */
  configure?(actor: A): void;
}

/**
 * What a level's `load` receives. Cue definitions belong to the engine, so a
 * cue loaded here survives every later transition.
 */
export interface LoadApi {
  /** The asset loaders, resolving under `assetRoot`. */
  readonly assets: InitApi["assets"];
  /** Binds a cue name to an audio file. */
  readonly audio: { load(cue: string, path: string): Promise<void> };
  /** The engine's broadcaster. */
  readonly events: EngineEvents;
}

/**
 * What `world.spawn` applies over the constructed actor. The three fields carry
 * the same meaning they carry on {@link ActorSpec}, applied in the same order;
 * `spawn` then runs the actor's `beginPlay` immediately, so a spawned actor is
 * fully live by the time `spawn` returns.
 */
export interface SpawnSpec<A extends Actor = Actor> {
  transform?: Partial<Transform>;
  tags?: readonly string[];
  configure?(actor: A): void;
}

/**
 * Identifies one scheduled callback; `clearTimer` is what it is for. Timers
 * count simulated world time, so a paused world runs none of them, and a
 * world's timers are cleared when it closes.
 */
export type TimerHandle = number;

/**
 * The live instance of a level: the world currently open, reached as
 * `engine.world` and, from inside the framework, through the `world` every
 * actor, component, controller, and game mode carries.
 *
 * One world is open at a time. Everything it owns — the game mode, the game
 * state, the actors, the controllers, the camera, the collision world, the
 * timers, and the world-scoped diagnostic sources — is rebuilt on a level
 * transition; what must survive travel lives on the game instance.
 */
export interface World {
  /** The name the world was opened under. */
  readonly level: string;
  /** The game mode running this world. */
  readonly mode: GameMode;
  /** The game state the mode built. */
  readonly state: GameState;
  /** The world's camera. */
  readonly camera: Camera;
  /** The world's collision queries and reported pairs. */
  readonly collision: CollisionWorld;
  /**
   * Seconds of simulated time the world has been stepped by, incremented
   * before the controllers tick. Restarts at zero on a level transition.
   */
  readonly time: number;
  /** Whether the world's simulation is suspended. A paused world still renders. */
  readonly paused: boolean;

  /** The cue bus this world plays through. */
  readonly audio: WorldAudio;
  /** The asset loaders, resolving under `assetRoot`. */
  readonly assets: InitApi["assets"];
  /**
   * The world's diagnostic registry. A source registered here lives as long as
   * the world and is dropped when it closes; the instance's sources persist.
   */
  readonly diagnostics: {
    register(name: string, source: () => DiagnosticValue): void;
  };
  /** The engine's broadcaster. */
  readonly events: EngineEvents;

  /**
   * Constructs the actor, applies `spec`, attaches it to the world, and runs
   * its `beginPlay` and each component's `beginPlay` before returning. Its
   * first `tick` is the next frame. Spawning emits `actor:spawned`.
   */
  spawn<A extends Actor>(type: ActorClass<A>, spec?: SpawnSpec<A>): A;
  /** Every live actor, in spawn order, as a copy the caller owns. */
  actors(): readonly Actor[];
  /** The live actors carrying `tag`, in spawn order. */
  byTag(tag: string): readonly Actor[];
  /** The live actors that are instances of `type`, in spawn order. */
  ofType<A extends Actor>(type: ActorClass<A>): readonly A[];
  /** The first entry {@link ofType} would return, or `null`. */
  find<A extends Actor>(type: ActorClass<A>): A | null;

  /** Every controller, player and AI alike, in the order they were added. */
  controllers(): readonly Controller[];
  /** The player controllers alone, in index order. */
  players(): readonly PlayerController[];

  /** Runs `fn` once, `seconds` of simulated world time from now. */
  after(seconds: number, fn: () => void): TimerHandle;
  /**
   * Runs `fn` every `seconds` of simulated world time, until cleared or the
   * world closes.
   */
  every(seconds: number, fn: () => void): TimerHandle;
  /** Cancels the scheduled callback the handle identifies. */
  clearTimer(handle: TimerHandle): void;

  /** Pauses or resumes the world's simulation. A paused world still renders. */
  setPaused(paused: boolean): void;
  /**
   * Requests a transition to `level`, deferred to the end of the frame. One
   * call per frame is honored: a second request replaces the first. `options`
   * reaches the incoming game mode as its `options` field.
   */
  open(level: string, options?: Readonly<Record<string, unknown>>): void;

  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* Game definition and instance                                               */
/* -------------------------------------------------------------------------- */

/**
 * The game instance class takes no constructor arguments, and the engine
 * constructs it with none.
 */
export type GameInstanceClass<D = unknown> = new () => GameInstance<D>;

/**
 * The whole game, as `EngineOptions.game` carries it: the level registry, the
 * start level, and the game instance class. One engine drives one definition
 * for its lifetime.
 *
 * `D` is the type of the debug surface the instance's `initialize` returns, and
 * `createEngine` infers it from the definition. A game with no surface is a
 * `GameDefinition<null>`.
 */
export interface GameDefinition<D = unknown> {
  /**
   * The class constructed once and kept across every level. Defaults to
   * `GameInstance` itself, which suits a game whose whole state fits in its
   * worlds.
   */
  instance?: GameInstanceClass<D>;
  /** The level registry, keyed by level name. At least one entry. */
  levels: Readonly<Record<string, LevelDefinition>>;
  /** The level `engine.initialize` opens. A key of `levels`. */
  startLevel: string;
}

/**
 * What the game instance's `initialize` receives. Everything declared here
 * belongs to the whole game and survives every level transition: the action
 * bindings, the cue definitions, the assets the instance holds, and the
 * diagnostic sources the overlay reads.
 */
export interface InitApi {
  readonly input: {
    /**
     * Registers or re-registers `name`. `binding.keys` is copied,
     * `binding.kind` defaults to `"digital"`, and `layout` resolves to the
     * selected layout's name when that layout's vocabulary contains `name`.
     * Re-registering replaces the binding wholesale, returns the action to
     * rest, and keeps its position in the registration order.
     */
    register(name: string, binding: ActionBinding): void;
    /** The layout selected by `EngineOptions.layout`, or `null`. */
    layout(): TouchLayout | null;
  };
  readonly audio: {
    /** Binds `cue` to a synthesized `spec`. */
    define(cue: string, spec: CueSpec): void;
    /**
     * Fetches and decodes the audio at `path` and binds the result to `cue`.
     * Resolves once the cue is playable.
     */
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    /** Resolves the path, fetches it, and decodes to an `ImageBitmap`. */
    loadImage(path: string): Promise<ImageBitmap>;
    /** Resolves the path, fetches it, and decodes to an `AudioBuffer`. */
    loadAudio(path: string): Promise<AudioBuffer>;
    /** Resolves the path, fetches it, and resolves to the body as a `Blob`. */
    load(path: string): Promise<Blob>;
    /** The URL `path` loads from. Pure: it neither fetches nor emits. */
    resolve(path: string): string;
  };
  readonly diagnostics: {
    /**
     * Registers a source that lives as long as the engine, invoked on each
     * read. Re-registering a name replaces its source in place.
     */
    register(name: string, source: () => DiagnosticValue): void;
  };
  /** The engine's broadcaster. */
  readonly events: EngineEvents;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

/** What `createEngine` is handed. */
export interface EngineOptions<D = unknown> {
  /** The canvas the engine sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the camera projects into. Finite and positive. */
  width: number;
  /** The logical design height the camera projects into. Finite and positive. */
  height: number;
  /** The game definition: the level registry, the start level, the instance class. */
  game: GameDefinition<D>;
  /** A CSS color cleared to before every frame. Absent, transparency. */
  background?: string;
  /**
   * Whether an image the viewport fit scales is resampled bilinearly. `false`
   * samples nearest-neighbor, which keeps pixel art crisp. Defaults to `true`.
   */
  imageSmoothing?: boolean;
  /** A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. */
  layout?: string;
  /** The clock supplying each frame's delta. Defaults to `new WallClock()`. */
  clock?: Clock;
  /**
   * Where the engine reads element size and device pixel ratio, and attaches
   * its key listeners. Defaults to reading the canvas.
   */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under. Defaults to `"assets/"`. */
  assetRoot?: string;
}

/** What {@link Engine.run} takes. */
export interface RunOptions {
  /** Aborting halts the loop and leaves the engine usable. */
  signal?: AbortSignal;
}

/**
 * The engine over one canvas and one game definition.
 *
 * `instance` and `world` are live references rather than copies, so a reader
 * observes the current frame's values; `world` follows each transition.
 * Reading `instance`, `world`, or `debug` before `initialize` resolves throws,
 * naming the ordering.
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
   * The debug surface the instance's `initialize` returned, unchanged. The
   * engine reads no member of it; a game with no surface returns `null` there.
   */
  readonly debug: D;
  /**
   * Construct the game instance, run its `initialize`, open `startLevel`, and
   * resolve to the instance. Resolving means the start level's `load` has
   * resolved, its actors are spawned and have begun play, and its game mode
   * has begun play; no frame runs before that. A second call resolves to the
   * instance already built.
   */
  initialize(): Promise<GameInstance<D>>;
  /**
   * Drive the game off the host's frame callback until the supplied signal
   * aborts or the engine is destroyed. The returned promise resolves once the
   * loop halts.
   */
  run(options?: RunOptions): Promise<void>;
  /**
   * Tick the clock `frames` times, back to back, running a frame for each tick
   * the clock accepts. `frames` must be a whole, non-negative number;
   * `advance(0)` runs nothing. A level transition requested during a frame is
   * awaited before the next frame begins.
   */
  advance(frames: number): Promise<void>;
  /**
   * Replace the clock in place; the frame counter and accumulated time carry
   * over, and the next frame takes its delta from the new one.
   */
  setClock(clock: Clock): void;
  /** The frame counter, the accumulated simulated time, and the last delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /**
   * Every registered diagnostic and what it reports now, the instance
   * registry's first and then the world's, each in registration order.
   *
   * Evaluates each source and changes nothing else, so a check reads the
   * sources a build registered without posing the overlay: the reading is the
   * same whether the panel is drawn or hidden.
   */
  diagnostics(): readonly DiagnosticReading[];
  /** Whether draw-command recording is currently capturing. */
  recording(): boolean;
  /**
   * Arm the recorder. Capture begins at the next frame. Throws while already
   * recording, naming the unbalanced call.
   */
  startRecording(): void;
  /**
   * Disarm the recorder and return everything captured since
   * `startRecording`. Throws while not recording, naming the unbalanced call.
   */
  stopRecording(): Recording;
  /**
   * Close the world (ending play for its controllers, actors, and game mode),
   * run the instance's `shutdown`, halt the loop, and drop every listener.
   * Idempotent. Destroying resolves any promise `run` returned.
   */
  destroy(): void;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one broadcaster that carries every engine event, reachable as
 * `engine.events`, as `world.events`, and as the `events` field on each API
 * object the framework hands a game.
 *
 * Handlers run synchronously at the moment the event happens, so a subscriber
 * sees the frame the event belongs to. A handler that throws is contained: the
 * error reaches the console and the remaining handlers still run.
 * Subscriptions live on the engine, so one made before `engine.initialize`
 * observes the start level being built and every transition after it.
 */
export interface EngineEvents {
  /** Subscribe. Returns the function that removes the handler. */
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

/** Every event the engine emits, with each one's payload. */
export interface EngineEventMap {
  /** A loader's value arrives. */
  "asset:loaded": { path: string; url: string };
  /** A loader refuses the path, or the fetch, the status, or the decode fails. */
  "asset:failed": { path: string; url: string; reason: string };
  /** `world.audio.play` runs, on a muted bus as well as an audible one. */
  "cue:played": { cue: string; t: number; gain: number };
  /** `world.audio.loop` starts a cue looping. */
  "cue:looped": { cue: string; t: number; gain: number };
  /** A running loop ends, by `stop` or by a redeclaration replacing the cue. */
  "cue:stopped": { cue: string; t: number };
  /** The engine opens the audio context, on the first pointer or key event. */
  "audio:unlocked": Record<string, never>;
  /** A transition begins, carrying the outgoing level name and the incoming one. */
  "world:opening": { from: string | null; to: string };
  /** The outgoing world's game mode has ended play. */
  "world:closed": { level: string };
  /** The incoming world is built and its game mode has begun play. */
  "world:opened": { level: string };
  /** An actor is spawned into the world. */
  "actor:spawned": { actor: Actor };
  /** An actor is destroyed. */
  "actor:destroyed": { actor: Actor };
  /** A controller takes a pawn or releases the one it held. */
  "possession:changed": {
    controller: Controller;
    pawn: Pawn | null;
    previous: Pawn | null;
  };
  /** `setPhase` sets a phase the game mode does not already hold. */
  "match:phase": { phase: MatchPhase; previous: MatchPhase };
  /** On the first frame the collision pass finds an overlapping pair. */
  "overlap:begin": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  /**
   * On the first frame the pass stops finding it, and when either actor is
   * destroyed or the world closes.
   */
  "overlap:end": {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
  };
  /** On every frame the pass finds a blocking pair. `a` has the lower `id`. */
  hit: {
    a: Actor;
    b: Actor;
    colliders: [ColliderComponent, ColliderComponent];
    manifold: Manifold;
  };
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the recorder hands back: the operations the rendering pipeline issued
 * against its 2D context, frame by frame, as a value a player re-issues against
 * another context to reproduce the picture.
 *
 * `images`, `resources`, `ops`, and `states` belong to the whole recording:
 * each holds every distinct entry once, and a frame names the entries it needs
 * by index, so any frame is drawable from the recording alone.
 */
export interface Recording {
  /** The format version, equal to `RECORDING_FORMAT`. */
  format: number;
  /** The logical design width the operations were issued in. */
  width: number;
  /** The logical design height the operations were issued in. */
  height: number;
  /** The CSS color each frame was cleared to, or `null` for transparency. */
  background: string | null;
  /** The bitmaps and pixel buffers the operations draw, by index. */
  images: readonly CapturedImage[];
  /** The values the context produced and the operations draw with, by index. */
  resources: readonly Resource[];
  /** Every distinct operation the recording holds, by index. */
  ops: readonly DrawOp[];
  /** Every distinct inherited state block, by index. */
  states: readonly DrawState[];
  /** The frames captured, in order. */
  frames: readonly RecordedFrame[];
}

/**
 * One captured frame, drawable from itself alone: blank the context, push each
 * `stack` entry outermost first, apply `states[state]`, then issue each of
 * `ops` in order.
 */
export interface RecordedFrame {
  /** The engine's frame counter at this frame. */
  count: number;
  /** Accumulated simulated time through this frame, in milliseconds. */
  timeMs: number;
  /** What this frame was worth, in milliseconds. */
  deltaMs: number;
  /** The canvas backing store this frame was drawn into, in device pixels. */
  surface: { width: number; height: number };
  /** Index into `states` of the state this frame inherited. */
  state: number;
  /**
   * Indices into `states` of the states the context had saved when this frame
   * opened, outermost first. At most 64 entries; the entries kept are the
   * innermost ones.
   */
  stack: readonly number[];
  /** Indices into `ops` of the operations this frame issued, in order. */
  ops: readonly number[];
  /**
   * Present and `true` when the save stack, a clip region, or the current path
   * this frame inherited was cut down to its bound.
   */
  truncated?: boolean;
}

/**
 * The context state a frame opened with: the style properties that survive a
 * frame boundary, the transform, the dash pattern, and the shadowed clip region
 * and current path — the two parts of canvas state a context does not report.
 */
export interface DrawState {
  /** The style properties in force at the top of the frame, by name. */
  properties: Readonly<Record<string, DrawValue>>;
  /** The transform as `[a, b, c, d, e, f]`, or `null` when the context reported none. */
  transform: readonly number[] | null;
  /** The dash pattern, or `null` when the context reported none. */
  lineDash: readonly number[] | null;
  /** The clip region in force, as the segments that built it, in applied order. */
  clip: readonly PathSegment[];
  /** The current path: the path operations issued since the last `beginPath`. */
  path: readonly PathSegment[];
}

/**
 * A run of path operations under one transform. A path is given in user space,
 * so a player replays each segment under the transform it carries before
 * setting the state's own.
 */
export interface PathSegment {
  /** The transform in force when the segment's operations were issued. */
  transform: readonly number[] | null;
  /** The path operations, in order. */
  ops: readonly DrawOp[];
}

/**
 * One operation the context performed on itself: a method call or a property
 * assignment. A `set` records the value the build supplied rather than the
 * value the context normalized it to.
 */
export type DrawOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };

/**
 * A portable encoding of any value an operation carried. `{ $res: n }` names
 * `resources[n]`, `{ $img: n }` names `images[n]`, and `{ $opaque: … }` marks a
 * value the recorder could not carry — including `"truncated"`, the remainder
 * of a container the expansion bound fell inside.
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
 * One image the recording carries: a `bitmap` rebuilds as an image a context
 * draws (`src` is a `data:image/png;base64,…` URL), and a `pixels` entry
 * rebuilds byte-for-byte as the `ImageData` a `putImageData` writes (`data` is
 * base64 RGBA, four bytes per pixel in row order).
 */
export type CapturedImage =
  | { kind: "bitmap"; width: number; height: number; src: string }
  | { kind: "pixels"; width: number; height: number; data: string };

/**
 * The recipe for a value the context produced — a gradient or a pattern: the
 * creating call and the mutations applied up to the moment of use. A player
 * issues `make` against the context it is drawing into, then applies each entry
 * of `then`.
 */
export interface Resource {
  /** The context call that created the value. */
  make: { method: string; args: readonly DrawValue[] };
  /** The calls and assignments made on the value before this use, in order. */
  then: readonly ResourceOp[];
}

/** One step of a {@link Resource} recipe. */
export type ResourceOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };
