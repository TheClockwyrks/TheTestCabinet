/**
 * The vocabulary shared by the engine's subsystems, by the game-facing API, and
 * by the events it publishes.
 *
 * These types are declared once, here, rather than beside the subsystem that owns
 * each one, because almost every one of them is spoken by more than one side of
 * the package. Keeping the declarations in a leaf module with no value imports means
 * the entry points cannot drift apart, and that `@test-cabinet/simple-3d` can be
 * consumed for its types alone without pulling in the DOM-bound engine.
 *
 * Two imports reach outside the module, and both are type-only. `DeepReadonly` is
 * the view every reader of a game's state is handed, and `three` supplies the four
 * classes the engine hands the game — the scene, the two cameras, a texture, and a
 * model's node tree. Importing `three` for its types alone is what keeps this module
 * value-free while still naming the objects the rendering surface is written in
 * terms of: `three` is a peer dependency the build declares itself, so the engine,
 * the build, and `@test-cabinet/voxel-runtime/three` share one instance, and the
 * engine re-exports nothing from it.
 */

import type * as THREE from "three";

// `DeepReadonly` from `ts-essentials` is the view every reader of a game's state
// is handed. The engine holds the state as the game's own `S`; nothing but the
// transition that produced it — `update`, or a transition a caller applies through
// {@link Engine.apply} — ever sees it writable. Re-exported so a game that wants
// the same view of its own state names it without a second import.
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
 * sequence of deltas under both, and a validator steps synchronously the scenario
 * a reviewer watches play.
 */
export interface Clock {
  /** This tick's delta in milliseconds, or `null` when the tick is not a frame. */
  delta(nowMs: number): number | null;
}

/**
 * What a paced clock may be tuned with.
 *
 * The only clock of the five with anything to configure beyond its rate: pacing is
 * a grid of due times, and the one open question is how far behind that grid the
 * clock chases before it gives up on the slots it missed.
 */
export interface PacedClockOptions {
  /**
   * Intervals behind the grid at which the clock abandons the missed slots and
   * restarts from the current tick; defaults to `4`.
   *
   * Bounding the catch-up is what turns a long stall into a pause rather than a
   * burst of frames replaying time the player did not experience.
   */
  resyncAfter?: number;
}

/* -------------------------------------------------------------------------- */
/* Frame                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The frame loop's position.
 *
 * `count` is the tick unit a check asserts against; `timeMs` is the accumulated
 * simulated time, which is the sum of the deltas delivered rather than elapsed
 * wall time; `lastDeltaMs` is what the most recent frame was stepped by. All three
 * are milliseconds, while the `dt` a game's `update` receives is seconds.
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
 * Frame timing over the recent past, and the renderer's cost for the last frame,
 * as the overlay reports them.
 *
 * The timing window is a duration rather than a frame count so the figures mean the
 * same thing at every frame rate: a run at 30 frames per second and one at 240 both
 * report the last ten seconds. The two renderer counts are not windowed at all —
 * they describe one frame, because a draw-call total averaged over ten seconds
 * answers no question a reader of a 3D overlay is asking.
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
  /** Draw calls the renderer issued for the most recent frame; `0` before the first render. */
  drawCalls: number;
  /** Triangles the renderer drew in the most recent frame; `0` before the first render. */
  triangles: number;
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
/* Math                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A point on the logical field: the design size the game declared, `x` rightward
 * and `y` downward from its top-left corner.
 *
 * Plain fields with no methods, so a value moves between the game's state, the
 * engine, and three's own classes through `set` and `toArray` and never obliges a
 * game to hold a three object where a pair of numbers would do.
 */
export interface Vec2 {
  /** The horizontal coordinate. */
  x: number;
  /** The vertical coordinate. */
  y: number;
}

/**
 * A point or a direction in the world.
 *
 * The world is right-handed with `+Y` up and the camera looks along its local `-Z`,
 * which is three's convention, so a triple written here means in the engine what it
 * means in every three example a build's author has read.
 */
export interface Vec3 {
  /** The world x. */
  x: number;
  /** The world y, up. */
  y: number;
  /** The world z. */
  z: number;
}

/**
 * A rotation as a unit quaternion, the identity being `{ x: 0, y: 0, z: 0, w: 1 }`.
 *
 * A quaternion rather than Euler angles because a rotation carried in a game's state
 * is interpolated, composed, and compared, and Euler angles are ambiguous under all
 * three: the order the axes apply in has to travel beside the numbers, and two
 * triples that name the same orientation do not compare equal.
 */
export interface Quat {
  /** The x component of the rotation axis, scaled by the half-angle sine. */
  x: number;
  /** The y component of the rotation axis, scaled by the half-angle sine. */
  y: number;
  /** The z component of the rotation axis, scaled by the half-angle sine. */
  z: number;
  /** The scalar component, the half-angle cosine. */
  w: number;
}

/**
 * Sixteen numbers in column-major order, as three stores a matrix, so entries
 * `12..14` are the translation.
 *
 * Declared as a bare array rather than a tuple because it is a value read out of
 * three through `toArray` and fed back through `fromArray`, and both sides already
 * agree on the length; a sixteen-element tuple would buy a check neither side asked
 * for at the cost of a cast at every boundary.
 */
export type Mat4 = readonly number[];

/**
 * An axis-aligned box in world units.
 *
 * What a bound, a trigger volume, or a query region is written as when the game
 * wants it in its own state rather than as a three object the state may not carry.
 */
export interface Box3 {
  /** The corner with the smallest coordinate on each axis. */
  min: Vec3;
  /** The corner with the largest coordinate on each axis. */
  max: Vec3;
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether an action reports a continuous magnitude or a plain on/off.
 *
 * An `analog` action is sampled every frame for its value, which is what lets a
 * stick's deflection reach the game as the fraction it actually is; a `digital`
 * action quantizes every non-zero magnitude to `1` and is usually consumed as an
 * edge. Declaring the kind lets the engine decide what a keyboard binding means for
 * that action.
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

/**
 * An action as the engine holds it, with every default resolved and its layout
 * provenance attached.
 *
 * The resolved form of a registration: the binding with its defaults filled in, so
 * a reader asks the registry what an action *is* rather than re-deriving what the
 * game left unsaid.
 */
export interface RegisteredAction {
  /** The action's name, as the game registered it. */
  name: string;
  /** The resolved `KeyboardEvent.code` bindings, as a copy. */
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
  /** The action names the layout provides, its own vocabulary followed by the four menu actions. */
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
 * one alone. Each position goes straight into {@link View.ray}, which is how a
 * pick resolves against the camera the player is looking through.
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
 * The contact list is what a pinch, a two-finger orbit, or two players on one
 * screen read. A game driving one thing with one pointer reads the snapshot
 * instead, which follows the primary pointer alone and is therefore unaffected by
 * a second finger landing on the screen.
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
 *
 * Logical units rather than the event's own, because a wheel reports lines or pages
 * as readily as pixels and a game that dollied its camera by the raw figure would
 * move a different distance on every browser.
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
 * Keeping the description this small covers the bleeps a game needs without a game
 * shipping audio assets or touching Web Audio. A game wanting a recorded sound
 * loads a produced audio file under the same name instead, and both play through
 * the same call.
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
  /** Peak gain in `[0, 1]`; defaults to `0.2`. A loop holds it. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. A loop ignores it. */
  durationMs: number;
}

/**
 * Where a cue is played, if anywhere.
 *
 * A cue with an `at` is routed through a panner at that world point and heard from
 * where the camera stands; a cue without one plays unpositioned, at the bus's gain
 * with no panning. The distinction is per playback rather than per cue, so one
 * declared sound serves both the clank of a specific object and the confirmation
 * beep that belongs to no place at all.
 */
export interface PlayOptions {
  /** The world point to place the cue at; absent plays it unpositioned. */
  at?: Vec3;
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
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A decoded glTF 2.0 model: the node tree, its animations, and the names inside it.
 *
 * A model is a *template* rather than something placed. A game clones it with
 * `cloneModel` and adds the clone to the scene, so one decode yields as many placed
 * copies as the game needs, each posed independently. The template itself is never
 * added, which is what keeps a second placement from silently re-parenting the
 * first.
 *
 * `nodes` is carried beside the tree because finding a node otherwise means
 * traversing it, and a game that rigs a hook to a crane arm wants to know at load
 * time whether the arm it expects is in the file at all.
 */
export interface Model {
  /** The decoded node tree, a template to clone rather than to place. */
  readonly scene: THREE.Group;
  /** Every animation clip the file carries, playable through a three `AnimationMixer`. */
  readonly animations: readonly THREE.AnimationClip[];
  /** Every node name in the tree, in traversal order. */
  readonly nodes: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** The events the engine broadcasts, by name, with the payload each carries. */
export interface EngineEventMap {
  /** An asset arrived. */
  "asset:loaded": { path: string; url: string };
  /** An asset was refused or failed to arrive. `url` is `""` for a refused path. */
  "asset:failed": { path: string; url: string; reason: string };
  /**
   * A cue played. `t` is frame-loop time; `gain` is `0` while muted; `at` is the
   * world point it was placed at, as a copy, or `null` for an unpositioned cue.
   */
  "cue:played": { cue: string; t: number; gain: number; at: Vec3 | null };
  /** A cue started looping, with the same three figures `cue:played` carries. */
  "cue:looped": { cue: string; t: number; gain: number; at: Vec3 | null };
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
 *
 * One fit serves both surfaces: it is the transform the screen layer's 2D context
 * carries and the rectangle the renderer's viewport and scissor are set to, so the
 * 3D picture and the HUD over it line up pixel for pixel.
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
 * it attaches its key and pointer listeners to.
 *
 * Every measurement the engine would otherwise take from the DOM passes through
 * here, which is what lets the engine run over a canvas with no document behind
 * it and gives a validator the same transform on every machine.
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
/* The camera and the view                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The camera the engine renders through: whichever of three's two projections
 * `EngineOptions.projection` selected.
 *
 * The class is fixed at construction and holds for the engine's life, so a game
 * that narrows with `instanceof` to write a perspective camera's `fov` narrows once
 * and stays narrowed. A union rather than the shared `THREE.Camera` base because
 * the fields a game poses — `fov`, or the four orthographic extents — live on the
 * subclasses, and a game handed the base would have to cast to reach any of them.
 */
export type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/**
 * The camera's pose and projection at one moment, as a plain value the caller owns.
 *
 * A snapshot rather than the camera itself: the camera is mutated in place by the
 * game's `render`, so a reader holding it would find its pose overwritten by a
 * later frame. Every field is present whichever projection the camera is, with the
 * fields the other projection owns reading `0`, so a check reads a figure without
 * narrowing on `projection` first.
 */
export interface CameraSnapshot {
  /** Which projection the camera is. */
  projection: "perspective" | "orthographic";
  /** The camera's world position. */
  position: Vec3;
  /** The camera's world rotation. */
  rotation: Quat;
  /** The vertical field of view in degrees. Perspective only; `0` for an orthographic camera. */
  fov: number;
  /** The near clipping plane, in world units along the view direction. */
  near: number;
  /** The far clipping plane, in world units along the view direction. */
  far: number;
  /** The camera's zoom factor. */
  zoom: number;
  /** The left orthographic extent, in world units. Orthographic only; `0` otherwise. */
  left: number;
  /** The right orthographic extent, in world units. Orthographic only; `0` otherwise. */
  right: number;
  /** The top orthographic extent, in world units. Orthographic only; `0` otherwise. */
  top: number;
  /** The bottom orthographic extent, in world units. Orthographic only; `0` otherwise. */
  bottom: number;
}

/**
 * A line in the world: where it starts and which way it goes.
 *
 * What picking reads. Through a perspective camera the ray starts at the camera's
 * position and points through the stage point; through an orthographic camera it
 * starts at the stage point on the near plane and points along the camera's view
 * direction — so a game intersecting it against its own geometry writes the same
 * arithmetic under either projection.
 */
export interface Ray {
  /** A world point the ray starts from. */
  origin: Vec3;
  /** The ray's direction in world space, unit length. */
  direction: Vec3;
}

/**
 * Where a world point lands on the logical field, and whether it is in view.
 *
 * `x` and `y` are in the same logical design coordinates the screen layer draws
 * in, so a readout anchored to a world point is drawn at the pair as it stands
 * rather than mapped again. A point outside the frustum still reports `x`, `y`,
 * and `depth`, so a game that wants an off-screen marker at the field's edge has
 * the direction to clamp; a point behind the camera reports `visible: false`.
 */
export interface Projected {
  /** The point's logical x. */
  x: number;
  /** The point's logical y. */
  y: number;
  /** Normalized device depth in `-1..1`, near to far. */
  depth: number;
  /** Whether the point lies inside the camera's frustum. */
  visible: boolean;
}

/**
 * The read side of the camera: picking into the world, projecting out of it, and
 * the camera's pose as a value.
 *
 * A `View` answers from the camera as it stood at the most recent render, because
 * the engine takes its reading after `render` returns. `update` therefore picks
 * against the camera the player is looking through — the one the previous frame
 * drew — and `render` reads that same pose, which coincides with the one it is
 * currently writing whenever the camera is still. Before the first render it
 * answers from the camera defaults.
 *
 * Every result is a fresh value, so nothing a caller holds is written by a later
 * render.
 */
export interface View {
  /** The camera's pose and projection as a snapshot the caller owns. */
  camera(): CameraSnapshot;
  /** A world-space ray through the logical stage point `(x, y)`. */
  ray(x: number, y: number): Ray;
  /** The logical stage point a world point draws at, with its depth and visibility. */
  project(point: Vec3): Projected;
}

/* -------------------------------------------------------------------------- */
/* The scoped APIs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a game may reach while it initializes.
 *
 * Everything a game declares once belongs here: its action bindings, its cue
 * definitions, the assets it needs, the values it wants on the overlay, and the
 * lights and static geometry it places in the scene.
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
    /** The selected touch layout and its vocabulary, as a fresh copy. */
    layout(): TouchLayout | null;
  };
  readonly audio: {
    /** Declare a synthesized cue under a name. */
    define(cue: string, spec: CueSpec): void;
    /** Back a cue with a produced audio file under the asset root. */
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    /** Load an image under the asset root, decoded ready to draw on the screen layer. */
    loadImage(path: string): Promise<ImageBitmap>;
    /** Load an image and wrap it as an sRGB texture, ready to assign as a material's `map`. */
    loadTexture(path: string): Promise<THREE.Texture>;
    /** Load and decode a glTF 2.0 model, `.glb` or `.gltf`, as a template to clone. */
    loadModel(path: string): Promise<Model>;
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
  /**
   * The engine's own scene, the same object `engine.scene` and `RenderApi.scene`
   * hand out. What a game places here during initialization is still there when
   * the first `render` runs.
   */
  readonly scene: THREE.Scene;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/**
 * What a game may reach while it updates.
 *
 * Nothing here draws, which is what lets a simulation be stepped and inspected
 * with no drawing surface taking part in the result. The one thing it reads about
 * the picture is {@link View}, because picking is a question the simulation asks:
 * what the player pointed at is decided against the camera the player was looking
 * through.
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
    /** Play a defined cue, at `options.at` when given. */
    play(cue: string, options?: PlayOptions): void;
    /** Start a defined cue looping, at `options.at` when given. Nothing happens if it already is. */
    loop(cue: string, options?: PlayOptions): void;
    /** Stop a looping cue. Nothing happens if it is not looping. */
    stop(cue: string): void;
    /** Move a running positioned loop to `at`. Nothing happens if the cue is not looping. */
    place(cue: string, at: Vec3): void;
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
  /** The camera as it stood at the most recent render, with picking and projection through it. */
  view(): View;
}

/**
 * What a game may reach while it renders.
 *
 * Nothing here reads input or plays a cue, so a frame's audible and observable
 * behavior is decided entirely by the update. What it carries instead are the two
 * surfaces a frame's picture is made of — the retained scene drawn through the
 * camera, and the 2D screen layer composited over it.
 */
export interface RenderApi {
  /** The engine's retained scene: what `render` added on one frame is still there on the next. */
  readonly scene: THREE.Scene;
  /**
   * The camera the engine renders through, posed by writing its position, its
   * orientation, and its projection fields. The engine holds a perspective
   * camera's `aspect` at the design aspect and updates the projection matrix
   * before rendering, so a write here takes effect on the same frame's picture.
   */
  readonly camera: SceneCamera;
  /**
   * The screen layer's 2D context, cleared and already carrying the logical
   * viewport transform, so HUD drawing is in the design size the game declared
   * and is composited over the 3D picture at the end of the frame.
   */
  readonly screen: CanvasRenderingContext2D;
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
  /**
   * The camera as it stood at the *previous* frame's render, since the engine
   * takes its reading after `render` returns. A point projected here is drawn
   * where the previous frame's camera placed it.
   */
  view(): View;
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
 * The state carries the simulation alone and never a three object. A three object
 * is mutated in place, and a `DeepReadonly` view of one would be a lie the game
 * would have to cast its way out of on every frame; so the objects a game builds
 * for its picture live on the render side, keyed by the ids the state carries.
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
   * Declare the game's bindings, cues and diagnostics, place what belongs in the
   * scene from the start, and build the game's state and its debug surface,
   * returned together as `[state, debug]`.
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
  /**
   * Draw the state the update left behind: update the scene's objects, pose the
   * camera, and draw the readouts on the screen layer.
   */
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
 * One frame of a recording, addressed by the engine's own counters.
 *
 * The video carries the pixels and nothing about the run that produced them, so
 * each frame's `count`, `timeMs`, and `deltaMs` are kept beside it: a check that
 * knows the simulation reached its interesting moment on frame 240 finds that
 * frame in the container by index, and a player seeking by simulated time has the
 * timestamp the encoder was given.
 */
export interface RecordedFrame {
  /** The engine's frame counter for this frame. */
  count: number;
  /** The engine's accumulated simulated time through this frame, in milliseconds. */
  timeMs: number;
  /** What this frame was worth, in milliseconds. */
  deltaMs: number;
}

/**
 * A recorded run: a video of the frames the engine drew.
 *
 * The evidence is the pixels. What the container holds is exactly what the
 * renderer drew and the game's screen layer put over it — every material, shader,
 * shadow, sprite, post-effect, and HUD operation — with the diagnostics overlay
 * outside it, because the recorder captures between the scene render and the
 * overlay. A 2D engine can carry its frames as the draw commands that produced
 * them; a 3D one cannot, because the picture is the product of the whole graphics
 * pipeline rather than of a list of calls a player could reissue.
 *
 * `frames.length` is the number of video frames the container holds, so a suite
 * reads the frame count from it and a player indexes the video's frames by it.
 */
export interface Recording {
  /** The WebM bytes: VP9, one video track. */
  video: Uint8Array;
  /** The frame width in device pixels. */
  width: number;
  /** The frame height in device pixels. */
  height: number;
  /** One entry per video frame, in order. */
  frames: readonly RecordedFrame[];
  /** `true` when the frame bound stopped capture before `stopRecording` did. */
  ended: boolean;
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

/** What a game hands `createEngine`. */
export interface EngineOptions<S, D = unknown> {
  /** The canvas the engine sizes, clears, and renders the scene through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game draws in. Finite and positive. */
  width: number;
  /** The logical design height the game draws in. Finite and positive. */
  height: number;
  /** The game this engine drives, bound for the engine's lifetime. */
  game: Game<S, D>;
  /**
   * A CSS color the whole canvas is cleared to before every frame, letterbox bars
   * included; absent clears to transparency. A game may also set
   * `scene.background`, which paints inside the viewport alone.
   */
  background?: string;
  /** A touch layout from the catalogue, whose vocabulary the game then registers. */
  layout?: string;
  /** The clock supplying each frame's delta; defaults to a wall clock. */
  clock?: Clock;
  /** Where the engine reads element size and pixel density. */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under; defaults to `"assets/"`. */
  assetRoot?: string;
  /**
   * The canvas the screen layer draws on; absent, the engine creates one from the
   * stage canvas's owning document. Supplying it is what lets a validator read the
   * HUD's pixels, or substitute its own context for the drawing operations.
   */
  screen?: HTMLCanvasElement;
  /** Which kind of camera the engine creates and renders through; defaults to perspective. */
  projection?: "perspective" | "orthographic";
  /** `true` enables PCF soft shadow maps on the renderer; defaults to `false`. */
  shadows?: boolean;
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
 * to {@link Engine.events} before anything the game does is observable. The scene
 * and the camera exist from construction for the same reason: both are
 * engine-owned objects, so a caller may watch what the game's own initialization
 * puts in the scene.
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
  /**
   * The scene the engine renders, live and retained: what `render` added on one
   * frame is still there on the next, and after the engine is destroyed. This is
   * what lets a check find an object by name and read its world position with no
   * pixels involved.
   */
  readonly scene: THREE.Scene;
  /** The camera the engine renders through, live and posed by the game's `render`. */
  readonly camera: SceneCamera;
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
  /** The camera as it stood at the most recent render, with picking and projection through it. */
  view(): View;
  /**
   * Every registered diagnostic and what it reports now, in registration order.
   *
   * Evaluates each source against the current state and changes nothing else, so
   * a check reads the sources a build registered without posing the overlay: the
   * reading is the same whether the panel is drawn or hidden.
   */
  diagnostics(): readonly DiagnosticReading[];
  /** Whether the recorder is currently capturing frames. */
  recording(): boolean;
  /**
   * Arm the recorder. Capture begins at the next frame, so a caller that arms it
   * from inside a frame records whole frames only.
   */
  startRecording(): void;
  /**
   * Disarm the recorder, flush the encoder, and resolve with everything captured
   * since `startRecording`. Asynchronous because the container is closed only
   * once the last frame's bytes are in it.
   */
  stopRecording(): Promise<Recording>;
  /** Halt the loop, drop every listener, and dispose the renderer. */
  destroy(): void;
}
