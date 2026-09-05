/**
 * The vocabulary shared by the engine's subsystems, by the framework classes a
 * game subclasses, and by the events the engine publishes.
 *
 * These types are declared once, here, rather than beside the subsystem that
 * owns each one, because almost every one of them is spoken by more than one
 * side of the package: the clock the engine holds is the clock a validator
 * installs, the pointer a controller reads is the pointer the surface reports,
 * the material a component declares is the material the pipeline substitutes,
 * and the recording the recorder writes is read by a player that never imports
 * the engine. Keeping the declarations in a module with no *value* imports
 * means the entry points cannot drift apart, and that
 * `@clockwyrks/structured-3d` can be consumed for its types alone without
 * pulling in the DOM-bound engine.
 *
 * Everything declared here is free of the framework classes — no `Actor`, no
 * `GameMode`, no `Component` appears in a field or a parameter below — so the
 * module is a leaf whose only import is a type-only one. That import is
 * `three`, which supplies the objects the 3D surface is written in terms of: a
 * texture a material samples, a geometry a mesh is built from, and the node
 * tree a loaded model carries. `three` is a peer dependency the build declares
 * itself, so the engine, the build, and `@clockwyrks/voxel-runtime/three`
 * share one instance, and the engine re-exports nothing from it.
 *
 * Everything here mirrors the API pages under
 * `docs/engines/structured-3d/apis/` — those pages are the specification, and a
 * type that disagrees with its page is wrong.
 */

import type * as THREE from "three";

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
 * stepped. That is a property of the caller's entry point — `engine.run` or
 * `engine.advance` — so a clock that ignores `nowMs` yields the same sequence
 * of deltas under both, which is what lets a validator step a scenario
 * synchronously and a reviewer watch the same scenario play.
 *
 * The delta is milliseconds. The engine converts it once per frame, so every
 * `tick(dt)` the framework calls on a controller, an actor, a component, or the
 * game mode receives seconds.
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
 * Frame timing over the recent past and the last frame's render counts, as the
 * diagnostics overlay reports them.
 *
 * The window is the last 10 seconds of frames measured against *simulated*
 * time, held in a ring buffer capped at 2048 samples. Percentiles are
 * nearest-rank over the window sorted ascending — `p95Ms` is the sample at
 * index `ceil(0.95 * samples) - 1` — and an empty window reports `0` for all
 * three figures.
 *
 * The two counts are not windowed. They are the renderer's own totals for the
 * world pass of the frame most recently rendered, read after the scene has been
 * rendered, because what a reader wants of them is what this picture cost
 * rather than what an average picture costs. Before the first render both are
 * `0`.
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
  /** The draw calls the renderer issued for the most recent frame. */
  drawCalls: number;
  /** The triangles the renderer drew for the most recent frame. */
  triangles: number;
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every value a diagnostic source may report.
 *
 * Three types, and the set is closed: the overlay draws one line per source, and
 * a reader of that line wants the presentation a `string` fixes, the magnitude a
 * `number` carries, or the flag a `boolean` states. A framework object such as an
 * actor is reduced to one of the three inside the source, which is where the
 * game's own vocabulary lives. Closing the set is also what lets a check compare
 * a reading against an expected value without narrowing it first.
 */
export type DiagnosticValue = string | number | boolean;

/**
 * One registered diagnostic and what it reports right now.
 *
 * Exactly one of `value` and `error` is present. A source that throws yields
 * `error` and no `value`, which keeps a failure distinguishable from every
 * reading a working source could produce: were the message reported as the
 * value, a defect in the game's source would arrive as a well-typed `string`
 * that a check comparing values could accept.
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
 * A point on the logical field: the design size handed to `createEngine`, `x`
 * rightward and `y` downward from its top-left corner.
 *
 * A screen-space shape's vertex is one, and so is the point `camera.logicalToRay`
 * turns into a line in the world. Plain fields with no methods, so a value moves
 * between the game, the engine, and three's own classes without obliging anyone
 * to hold a three object where a pair of numbers would do.
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
 * The world is right-handed with `+Y` up and a camera or a light looks along its
 * local `-Z`, which is three's convention, so a triple written here means in the
 * engine what it means in every three example a build's author has read.
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
 * An axis-aligned rectangle, placed by `x`/`y` and sized by `width`/`height`.
 *
 * A rectangle on the logical field or in an image, in the units of whatever
 * names it: a `SpriteComponent`'s `source` region is one, in the image's pixels.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A rotation as a unit quaternion, the identity being `{ x: 0, y: 0, z: 0, w: 1 }`.
 *
 * A quaternion rather than Euler angles because a rotation carried on a
 * transform is interpolated, composed, and compared, and Euler angles are
 * ambiguous under all three: the order the axes apply in has to travel beside
 * the numbers, and two triples that name the same orientation do not compare
 * equal. Every helper that takes one reads it as unit length and every helper
 * that returns one returns unit length.
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
 * three through `toArray` and fed back through `fromArray`, and both sides
 * already agree on the length; a sixteen-element tuple would buy a check neither
 * side asked for at the cost of a cast at every boundary.
 */
export type Mat4 = readonly number[];

/**
 * An axis-aligned box in world units, holding every point whose coordinates lie
 * between `min` and `max` on each axis.
 *
 * A collider's `bounds()` returns one and the camera's `bounds` takes one, so
 * the same record is both what the engine measured and what a game constrains
 * against.
 */
export interface Box3 {
  /** The corner with the smallest coordinate on each axis. */
  min: Vec3;
  /** The corner with the largest coordinate on each axis. */
  max: Vec3;
}

/**
 * Where something is: a position, a rotation, and a scale, in world units.
 *
 * The identity is `position {0, 0, 0}`, `rotation {0, 0, 0, 1}`, and
 * `scale {1, 1, 1}`, and a `Partial<Transform>` on an `ActorSpec` or a
 * `SpawnSpec` fills its absent fields from it — a field given is given whole,
 * so a spec naming `rotation` names the whole quaternion.
 *
 * A transform places a point by scaling it, then rotating it, then translating
 * it, which is the order three composes a matrix from the same three parts. An
 * actor's `transform` and a component's `offset` are plain mutable records, so
 * movement is an assignment to a field rather than a call.
 */
export interface Transform {
  /** Translation, in world units. */
  position: Vec3;
  /** Orientation, a unit quaternion. */
  rotation: Quat;
  /** Scale along each local axis. */
  scale: Vec3;
}

/* -------------------------------------------------------------------------- */
/* Camera and viewport                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Where a world point lands on the logical field, as `camera.worldToLogical`
 * reports it.
 *
 * `depth` and `visible` travel with the pair of coordinates because a projection
 * in three dimensions can succeed arithmetically and still mean nothing: a point
 * behind the camera projects to a perfectly plausible `x` and `y`. A caller that
 * only reads the pair would draw a marker for something the player cannot see.
 */
export interface Projected {
  /** The logical x the world point draws at. */
  x: number;
  /** The logical y the world point draws at. */
  y: number;
  /** Normalized device depth in `-1..1`, near to far. */
  depth: number;
  /** Whether the point lies inside the camera's frustum. */
  visible: boolean;
}

/**
 * A world-space line: `origin` in world units and `direction` at unit length.
 *
 * `camera.logicalToRay` builds one from a logical point, and the collision
 * world's raycasts consume it, so a pointer pick is those two calls and nothing
 * else.
 */
export interface Ray {
  /** A point on the line, in world units. */
  origin: Vec3;
  /** The line's direction, unit length. */
  direction: Vec3;
}

/**
 * The camera's pose and projection at one moment, as a plain value the caller
 * owns.
 *
 * `camera.snapshot()` returns one, and a `DrawComponent` reads one from
 * `api.camera()`. A held snapshot keeps the values of the frame it was read in.
 *
 * Both projections are described by one record, with the fields the projection
 * in force does not use reporting `0`, so a reader switches on `projection`
 * rather than on which fields happen to be present. Under `orthographic`, `top`
 * is `orthoHeight / 2`, `bottom` is `-top`, `right` is `top * width / height`,
 * and `left` is `-right`.
 */
export interface CameraSnapshot {
  /** The projection in force. */
  projection: "perspective" | "orthographic";
  /** The camera's world position. */
  position: Vec3;
  /** The camera's world rotation, a unit quaternion. */
  rotation: Quat;
  /** The vertical field of view in degrees under `perspective`, else `0`. */
  fov: number;
  /** The near clipping plane, in world units from the camera. */
  near: number;
  /** The far clipping plane, in world units from the camera. */
  far: number;
  /** Three's zoom factor; the world's camera reports `1`. */
  zoom: number;
  /** The orthographic left extent in world units, else `0`. */
  left: number;
  /** The orthographic right extent in world units, else `0`. */
  right: number;
  /** The orthographic top extent in world units, else `0`. */
  top: number;
  /** The orthographic bottom extent in world units, else `0`. */
  bottom: number;
}

/**
 * The affine map from the logical design size onto the canvas's backing store.
 *
 * `scale` and both offsets are *device* pixels — the device pixel ratio is
 * folded into `scale`, so the CSS-pixel figure is `scale` divided by the ratio.
 * The world pass renders into the letterboxed rectangle the same three numbers
 * describe, and the screen pass carries them as the screen layer's context
 * transform, so one fit governs both passes. Every read
 * (`engine.viewport()`, `world.viewport()`, `InitApi.viewport()`,
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
 *
 * The position is a point on the logical field, which is what
 * `camera.logicalToRay` takes, so aiming is the snapshot turned into a ray and
 * cast.
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
 * The one place a game reads its actions, reached as `PlayerController.input`.
 *
 * Each player controller consumes edges independently: an armed edge is
 * `pressed` exactly once for each controller that asks, and within one
 * controller the first read consumes it. The engine closes the input frame
 * after the frame renders, discarding every edge left unconsumed, so a press is
 * news for exactly one frame — a paused world still renders and still closes
 * its input frame.
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
   * Every sample every pointer delivered since the input frame last closed, in
   * arrival order, as a fresh copy. Reading does not consume the list. At most
   * 1024 samples are listed per frame; a burst past that bound still moves the
   * snapshot, the contacts, and the edges.
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

/**
 * Where a cue sounds from.
 *
 * `at` is a world point in the same units and axes as an actor's
 * `Transform.position`, routed through a panner heard from the camera. A cue
 * played without it is unpositioned, which is what a menu blip and a piece of
 * music want: the option is absent rather than defaulted to the origin, so a
 * game never accidentally places a sound it meant to hear everywhere.
 */
export interface PlayOptions {
  /** The world point the cue sounds from. Absent, the cue is unpositioned. */
  at?: Vec3;
}

/**
 * The cue bus of one world, reached as `world.audio`.
 *
 * Cue definitions and running loops belong to the engine rather than the world,
 * so a loop started in one level keeps running across a transition until a tick
 * stops it and is then heard from the new world's camera. What the world
 * supplies is the seam: an actor, a component, a controller, and a game mode
 * all reach the bus through the world they belong to, and playback therefore
 * belongs to the same tick that advanced the simulation.
 */
export interface WorldAudio {
  /**
   * Emits `cue:played` and, when audible, sounds the cue. Returns immediately.
   * Throws for a cue that was never declared, naming it.
   */
  play(cue: string, options?: PlayOptions): void;
  /**
   * Starts the cue looping if it is not already, emitting `cue:looped` once.
   * Does nothing for a cue already looping; throws for an undeclared one.
   */
  loop(cue: string, options?: PlayOptions): void;
  /**
   * Stops the cue's loop if it is looping, emitting `cue:stopped` once. Does
   * nothing for a cue that is not looping; throws for an undeclared one.
   */
  stop(cue: string): void;
  /**
   * Moves the cue's running loop to `at`, whether or not the loop was started
   * with a position. A no-op for a cue that is not looping, and it emits
   * nothing.
   */
  place(cue: string, at: Vec3): void;
  /** Whether the cue is looping. `false` for an undeclared cue. */
  looping(cue: string): boolean;
  /**
   * Sets the mute bit. A muted cue still emits its event, reporting `gain: 0`,
   * and every running loop follows the bit live rather than being restarted.
   */
  setMuted(muted: boolean): void;
  /** The mute bit. */
  muted(): boolean;
}

/**
 * The audio bus's two bits: whether it is muted, and whether a user gesture has
 * opened the audio context.
 *
 * They are separate because a browser will not open a context before a gesture
 * whatever the game asks, so a silent bus is either the game's choice or the
 * page's state, and a build diagnosing silence needs to know which.
 */
export interface AudioState {
  /** Whether the bus is muted. */
  muted: boolean;
  /** Whether a user gesture has opened the audio context. */
  unlocked: boolean;
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A decoded glTF 2.0 model: the node tree, its animations, and the names inside
 * it.
 *
 * A model is a *template* rather than something placed. A `ModelComponent`
 * clones `scene` on construction, with a skinned mesh bound to its own copy of
 * the skeleton, so one decode backs any number of components and each animates
 * on its own. The template itself is never added to the scene, which is what
 * keeps a second placement from silently re-parenting the first.
 *
 * `animations` names what `ModelComponent.play` accepts and `nodes` names what
 * `ModelComponent.node` hands back a handle for, both carried beside the tree
 * because finding either otherwise means traversing it: a game that rigs a hook
 * to a crane arm wants to know at load time whether the arm it expects is in
 * the file at all.
 */
export interface Model {
  /** The decoded node tree, a template to clone rather than to place. */
  readonly scene: THREE.Group;
  /** Every animation clip the file carries, each named as the file names it. */
  readonly animations: readonly THREE.AnimationClip[];
  /** Every node name in the tree, in traversal order. */
  readonly nodes: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Collision                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How a pair of colliders answers for each other.
 *
 * Ordered `ignore` below `overlap` below `block`: a pair is evaluated in both
 * directions and takes the stronger of the two answers, so one side declaring
 * `"block"` is enough and a game that wants a pair left alone declares
 * `"ignore"` on both.
 */
export type CollisionResponse = "ignore" | "overlap" | "block";

/**
 * The volume a collider tests with, centered on the component's world transform
 * and sized in world units.
 *
 * Three shapes and no more, because detection is exact and cheap for each of
 * them and a game that needs a shape outside the set composes it from several
 * colliders at different offsets. A box and a capsule are oriented by the
 * transform's rotation; a sphere ignores it. Scale applies too: a box's extents
 * scale per axis, a capsule's `height` by the Y factor, and a radius by the
 * largest of the three factors.
 */
export type ColliderShape =
  | { kind: "box"; width: number; height: number; depth: number }
  | { kind: "sphere"; radius: number }
  | { kind: "capsule"; radius: number; height: number };

/**
 * What a `ColliderComponent` is constructed with.
 *
 * A channel is a name this collider is on and a name every other collider
 * answers for. The vocabulary belongs to the game: a channel is any string, and
 * the game fixes the set it uses.
 */
export interface ColliderOptions {
  /** The shape tested, in world units relative to the component's world transform. */
  shape: ColliderShape;
  /** The channel this collider is on. Defaults to `"default"`. */
  channel?: string;
  /**
   * How this collider answers a collider on each named channel. An unlisted
   * channel answers `"ignore"`.
   */
  responses?: Readonly<Record<string, CollisionResponse>>;
}

/**
 * How a blocking pair is separated, carried by every `hit` event.
 *
 * The engine finds the pair and moves nothing, so the manifold is the whole of
 * what it can say: multiplying `normal` by `depth` gives the smallest
 * translation that separates the two, and the game decides which of them takes
 * it. The orientation follows the reported order of the pair — `normal` points
 * from the first collider toward the second — so a handler reads it without
 * having to work out which side moved.
 */
export interface Manifold {
  /** The unit direction from the first collider of the pair toward the second. */
  normal: Vec3;
  /** How far the two shapes penetrate along `normal`, in world units. */
  depth: number;
  /** A point on the shared boundary. */
  point: Vec3;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How the pipeline draws everything it collects.
 *
 * The mode belongs to the pipeline rather than to any component, so every game
 * has all four without implementing any: in the world pass the mode substitutes
 * materials at draw time, `Object3DComponent` subtrees and loaded models
 * included, and in the screen pass it reduces what each component draws.
 * `wireframe` is every mesh as its edges in one flat color, `unlit` is every
 * base color and map at full opacity, and `normals` colors every surface by its
 * world-space normal; all three ignore the scene's lights.
 */
export type RenderMode = "shaded" | "wireframe" | "unlit" | "normals";

/**
 * Which of the two passes a render component draws in.
 *
 * Fixed by the component's class rather than settable, because the two passes
 * read a component's composed transform differently — a `world` component's is
 * a place in the world, a `screen` component's is a place on the logical field —
 * and a component that could change its mind would have to mean both.
 */
export type RenderSpace = "world" | "screen";

/**
 * The pipeline's two switches, reached as `engine.renderer` and available from
 * construction.
 *
 * Both belong to whoever holds the engine rather than to the game, which is the
 * point: a reviewer flips a build into `wireframe` or turns the collision
 * overlay on to see a shape the build never drew, without the build having
 * written a line for either.
 */
export interface Renderer {
  /** The mode in force, `"shaded"` until it is set. */
  mode(): RenderMode;
  /** Sets the mode. The next frame the pipeline runs draws under it. */
  setMode(mode: RenderMode): void;
  /** Whether the collision overlay draws. */
  collisionOverlay(): boolean;
  /**
   * Turns the collision overlay on or off. It draws every enabled collider's
   * shape as a wireframe in the world pass, in a color per response, after the
   * scene and with depth testing off, and is independent of the mode.
   */
  setCollisionOverlay(enabled: boolean): void;
}

/**
 * What a `DrawComponent` is handed to draw itself with.
 *
 * The direct-drawing path onto the screen layer, for a case that measures the
 * drawing itself. The context already carries the viewport transform, so the
 * component states every coordinate in logical units from the top-left of the
 * design field; a component drawing against the world reads `camera()` and
 * projects through `camera.worldToLogical`. Render modes belong to the
 * declarative pipeline, so a `DrawComponent` reads `mode` and supplies its own.
 */
export interface DrawApi {
  /** The screen layer's 2D context, already carrying the viewport transform. */
  readonly ctx: CanvasRenderingContext2D;
  /** The render mode in force for this frame. */
  readonly mode: RenderMode;
  /** The frame counter, the accumulated simulated time, and the most recent delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** The camera's pose and projection for this frame, as a snapshot the caller owns. */
  camera(): CameraSnapshot;
}

/* -------------------------------------------------------------------------- */
/* Component declarations                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a `MeshComponent` is built from.
 *
 * Five parameterized primitives cover what a game blocks a level out of, and
 * `custom` is the escape hatch for everything else: a game that has a
 * `THREE.BufferGeometry` — authored, generated, or pulled off a loaded model —
 * hands it over rather than describing it. Every geometry is centered on the
 * component's transform and every dimension is in world units, so a shape's
 * numbers mean the same thing as a collider's.
 */
export type MeshGeometry =
  | { kind: "box"; width: number; height: number; depth: number }
  | { kind: "sphere"; radius: number; segments?: number }
  | {
      kind: "cylinder";
      radiusTop: number;
      radiusBottom: number;
      height: number;
      segments?: number;
    }
  | { kind: "capsule"; radius: number; height: number }
  | { kind: "plane"; width: number; height: number }
  | { kind: "custom"; geometry: THREE.BufferGeometry };

/**
 * What a mesh is drawn with, as a declaration the pipeline builds a three
 * material from.
 *
 * A declaration rather than a material object because the render modes
 * substitute materials at draw time: the pipeline has to know what the game
 * meant — a base color, a map, a side — to answer for it in `unlit` or
 * `normals`, and a `THREE.Material` handed over whole would only say what it
 * happens to be. A game that wants a material of its own reaches for
 * `Object3DComponent` instead.
 */
export interface MaterialSpec {
  /**
   * The material model: physically based, Lambert diffuse, or unlit. Defaults
   * to `"standard"`.
   */
  kind?: "standard" | "lambert" | "basic";
  /** The base color. Defaults to `"#ffffff"`. */
  color?: string;
  /** The emissive color. Defaults to `"#000000"`. */
  emissive?: string;
  /** The `standard` metalness. Defaults to `0`. */
  metalness?: number;
  /** The `standard` roughness. Defaults to `1`. */
  roughness?: number;
  /** A texture sampled as the base color, loaded through `loadTexture`. */
  map?: THREE.Texture;
  /** Multiplied by the component's own `opacity`. Defaults to `1`. */
  opacity?: number;
  /** Whether the material draws as edges. Defaults to `false`. */
  wireframe?: boolean;
  /** Whether faces are shaded flat. Defaults to `false`. */
  flatShading?: boolean;
  /** Which faces are drawn. Defaults to `"front"`. */
  side?: "front" | "back" | "double";
}

/**
 * A live view onto one node's local transform inside a `ModelComponent`'s
 * clone.
 *
 * Writing its fields poses that node directly, which is how a game drives a
 * joint the voxel exporter named without owning the tree. It is a view rather
 * than a copy precisely so the write lands: a handle read once at `beginPlay`
 * keeps working for the life of the component.
 */
export interface NodeHandle {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

/**
 * What a `LightComponent` declares, as a spec the pipeline builds a three light
 * from.
 *
 * An ambient and a hemisphere light have no position. A point light shines from
 * the component's world position, and a directional or spot light shines from
 * it along the component's world forward axis, `FORWARD` rotated by the
 * component's world rotation — so a light is aimed by rotating the actor that
 * carries it, like everything else in the world.
 */
export type LightSpec =
  | { kind: "ambient"; color?: string; intensity?: number }
  | { kind: "hemisphere"; sky?: string; ground?: string; intensity?: number }
  | {
      kind: "directional";
      color?: string;
      intensity?: number;
      castShadow?: boolean;
    }
  | {
      kind: "point";
      color?: string;
      intensity?: number;
      distance?: number;
      decay?: number;
    }
  | {
      kind: "spot";
      color?: string;
      intensity?: number;
      angle?: number;
      penumbra?: number;
      distance?: number;
      decay?: number;
      castShadow?: boolean;
    };

/**
 * What a `SpriteComponent` is constructed with.
 *
 * A sprite is a `screen` component, so its sizes are logical units rather than
 * pixels and it holds its place on the canvas whatever the camera does, which
 * is what a HUD element and a 2D overlay want.
 */
export interface SpriteOptions {
  /** The decoded bitmap the component draws. */
  image: ImageBitmap;
  /** A region of a sprite sheet, in the image's pixels. `null` selects the whole image. */
  source?: Rect;
  /** The drawn width in logical units. Defaults to the source region's pixel width. */
  width?: number;
  /** The drawn height in logical units. Defaults to the source region's pixel height. */
  height?: number;
  /** The horizontal anchor, as a fraction of the drawn size. Defaults to `0.5`. */
  anchorX?: number;
  /** The vertical anchor, as a fraction of the drawn size. Defaults to `0.5`. */
  anchorY?: number;
  /** A CSS color the image is tinted with. Defaults to no tint. */
  tint?: string;
}

/**
 * What a `ShapeComponent` draws, on the logical field.
 *
 * Flat and two-dimensional, because a `ShapeComponent` is a `screen` component:
 * a rect and a polygon are centered on the component's transform and a
 * polygon's points are logical units relative to it. The volumetric shape a
 * collider tests with is `ColliderShape`.
 */
export type Shape2D =
  | { kind: "rect"; width: number; height: number }
  | { kind: "circle"; radius: number }
  | { kind: "polygon"; points: readonly Vec2[] };

/**
 * What a `ShapeComponent` is constructed with. A component with neither a fill
 * nor a stroke draws nothing.
 */
export interface ShapeOptions {
  /** The geometry drawn. */
  shape: Shape2D;
  /** A CSS color filled inside the shape. Defaults to no fill. */
  fill?: string;
  /** A CSS color stroked around the outline. Defaults to no stroke. */
  stroke?: string;
  /** The stroke width, in logical units. Defaults to `1`. */
  strokeWidth?: number;
}

/**
 * What a `TextComponent` is constructed with.
 *
 * The font size inside `font` is a logical unit like every other size a
 * `screen` component states, so a readout keeps its size on the canvas whatever
 * the camera does.
 */
export interface TextOptions {
  /** The string drawn. */
  text: string;
  /** A CSS font shorthand. Defaults to `"16px sans-serif"`. */
  font?: string;
  /** The fill color. Defaults to `"#ffffff"`. */
  fill?: string;
  /** Horizontal alignment against the component's transform. Defaults to `"center"`. */
  align?: "left" | "center" | "right";
  /** Vertical alignment against the component's transform. Defaults to `"middle"`. */
  baseline?: "top" | "middle" | "bottom";
}

/* -------------------------------------------------------------------------- */
/* The match and the lifecycle                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a match stands.
 *
 * A mode holds `"waiting"` when it begins play, `GameState.elapsed` accumulates
 * only while it is `"playing"`, and `"over"` means decided. The phase changes
 * only through `GameMode.setPhase`, which writes it onto the game state and
 * emits `match:phase`, so a check watching the event and a check reading the
 * state can never disagree about which phase the match is in.
 */
export type MatchPhase = "waiting" | "playing" | "over";

/**
 * Why something is ending play.
 *
 * The distinction is what lets an object clean up in proportion: a `destroyed`
 * actor drops the loop it started and the tag it lent a peer, while a
 * `level-closed` one need not, since the world and everything in it is going
 * away together.
 */
export type EndPlayReason = "destroyed" | "level-closed";

/* -------------------------------------------------------------------------- */
/* Worlds                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Identifies one callback scheduled through `world.after` or `world.every`, and
 * is what `world.clearTimer` cancels.
 *
 * Timers count simulated world time, so a paused world runs none of them, and a
 * world's timers are cleared when it closes — a handle held across a transition
 * names nothing.
 */
export type TimerHandle = number;

/* -------------------------------------------------------------------------- */
/* The engine                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What `engine.run` is driven by.
 *
 * The signal is how a caller ends a loop it started: aborting it halts the loop
 * and leaves the engine usable, where `engine.destroy` also tears the engine
 * down, so the two are separate acts. Omitting the signal runs until the engine
 * is destroyed.
 */
export interface RunOptions {
  /** Aborting it halts the loop and resolves the promise `run` returned. */
  signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One frame of a recording, addressed by the engine's own counters.
 *
 * The video carries the pixels and nothing about the run that produced them, so
 * each frame's `count`, `timeMs`, and `deltaMs` are kept beside it: a check that
 * knows the simulation reached its interesting moment on frame 240 finds that
 * frame in the container by index, and a player seeking by simulated time has
 * the timestamp the encoder was given. The engine's counter and accumulated
 * time survive every level transition, so a recording that spans one stays
 * addressable throughout.
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
 * pipeline drew — the background and the letterbox bars, the world pass under
 * the render mode in force, the collision overlay when it is on, every
 * screen-space component, and whatever a `DrawComponent` drew — with the
 * diagnostics overlay outside it, because the recorder captures between the
 * screen pass and the overlay. A 2D engine can carry its frames as the draw
 * commands that produced them; a 3D one cannot, because the picture is the
 * product of the whole graphics pipeline rather than of a list of calls a
 * player could reissue.
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
