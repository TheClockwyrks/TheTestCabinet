/**
 * `@clockwyrks/structured-3d` — the **Structured 3D** engine: the runtime a
 * produced 3D game is built *inside*.
 *
 * The package has one entry point, this module, and it is what a game and a
 * validator both import. `three` is a peer dependency: a build declares it itself
 * and imports it directly wherever it needs a three object, so the engine, the
 * build, and `@clockwyrks/voxel-runtime/three` share one instance. The engine
 * re-exports nothing from `three`.
 *
 * Where the Simple family hands a game a loop and a renderer, this engine hands it
 * an object model and owns everything around it: the gameplay framework — a game
 * instance that outlives every level, worlds built from level descriptions, a game
 * mode and game state that decide and record a match, actors assembled from
 * components, and controllers that possess and drive pawns — the frame loop and the
 * replaceable clock that decides what each frame is worth, the letterboxed
 * device-pixel-ratio-aware fit from the logical design size onto the element, the
 * camera whose frustum projects world units into that field, the pipeline that
 * collects every enabled, visible render component and draws it through a
 * `THREE.WebGLRenderer` under one of four render modes, the 2D screen layer
 * composited over that picture, volumetric collision detection reported as events
 * and manifolds, named input actions read only through a player controller, the
 * audio cue bus with its positional cues and its first-gesture unlock, asset
 * resolution under one fixed root, the diagnostics overlay, the recorder that
 * captures the frames the pipeline drew as video, and the debug surface the game
 * instance returned from its `initialize`.
 *
 * The game owns the levels it registers, the game modes that hold its rules, the
 * actors and components that populate a world, and the controllers that drive its
 * pawns. A build writes subclasses; the engine constructs, ticks, renders, and
 * tears down, in a fixed order, and detection belongs to the engine while response
 * belongs to the game — nothing the engine reports moves anything.
 */

/**
 * The vector, quaternion, and transform helpers a game moves things with.
 *
 * Plain functions over plain records rather than methods on a class: a
 * {@link Transform} is data the engine reads and the game replaces, so the
 * helpers that build one take values and return fresh values, and none of them
 * writes through an argument. A build that wants three's own math imports
 * `three` itself — the engine re-exports nothing from it.
 */
export {
  VEC3_ZERO,
  VEC3_ONE,
  UP,
  FORWARD,
  RIGHT,
  QUAT_IDENTITY,
  vec3,
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  normalize,
  distance,
  lerp,
  quat,
  quatFromEuler,
  quatToEuler,
  quatFromAxisAngle,
  quatMultiply,
  quatInverse,
  quatRotate,
  quatSlerp,
  quatLookAt,
  composeTransforms,
  transformPoint,
  transformToMatrix,
} from "./math";

/**
 * The clocks that decide what a frame is worth.
 *
 * A run takes {@link WallClock} and follows real time; a check takes one of the
 * scripted clocks and steps the same sequence synchronously, so what a reviewer
 * watches and what a validator drives are the same frames.
 */
export {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
  WallClock,
} from "./clocks";
export type { PacedClockOptions } from "./clocks";

/**
 * The closed catalogue of touch layouts an engine may be built with.
 *
 * A game reads actions through its player controller and never through this
 * table; it is exported so a build can name a layout it supports and a check
 * can assert the actions that layout carries.
 */
export { TOUCH_LAYOUTS } from "./input";

/**
 * The factory that builds an engine, and the two types it is described by.
 *
 * `createEngine` is the whole of the package's runtime entry: everything else a
 * game imports is a class it subclasses, a helper it calls, or a type it writes
 * against. `Engine` is what the factory hands back — the framework objects live,
 * the loop, the recorder, and the debug surface — and `EngineOptions` is what it
 * takes.
 */
export { createEngine } from "./engine";
export type { Engine, EngineOptions } from "./engine";

/**
 * The one event stream, as a subscriber sees it.
 *
 * `EngineEventMap` is the specification of what can be announced and what each
 * announcement carries; `EngineEvents` is the single-method interface every seam
 * hands out. A game and a validator both reach the same broadcaster — as
 * `engine.events`, as `world.events`, and as the `events` field on each API
 * object — so a subscription made before `engine.initialize` watches the start
 * level being built and keeps watching across every transition after it.
 */
export type { EngineEventMap, EngineEvents } from "./events";

/**
 * The game instance: the one object that outlives every level.
 *
 * A game subclasses {@link GameInstance} to declare what belongs to the whole
 * game — its actions, its cues, its assets, its engine-scoped diagnostics — and
 * returns the debug surface a validator drives it through. `GameDefinition` is
 * what `EngineOptions.game` carries: the level registry, the start level, and
 * the instance class.
 */
export { GameInstance } from "./game-instance";
export type {
  GameDefinition,
  GameInstanceClass,
  InitApi,
} from "./game-instance";

/**
 * Levels and the worlds they open into.
 *
 * A {@link LevelDefinition} is inert data — a game mode class, the actors the
 * level places, and the `load` the engine awaits before building anything — so
 * the same description opens as many times as a game asks. `World` is the live
 * object every actor, component, controller, and game mode reaches, and the one
 * `engine.world` hands out.
 */
export type {
  ActorSpec,
  LevelDefinition,
  LoadApi,
  SpawnSpec,
  World,
} from "./worlds";

/**
 * The game mode, the game state, and the per-player state.
 *
 * The mode holds the rules of a match and is the only thing that changes its
 * phase; the state is the record a validator reads it back from. Both are
 * rebuilt by every level opening, which is what makes a match a property of the
 * world rather than of the engine.
 */
export { GameMode, GameState, PlayerState } from "./game-mode";
export type { BotOptions, GameModeClass, PlayerOptions } from "./game-mode";

/**
 * Actors: the things a world contains, and the pawns a controller possesses.
 *
 * An actor is a transform, a list of components, and a life — it is not a
 * behaviour of its own. A {@link Pawn} adds only the possession link, so what
 * drives it is a controller rather than the actor itself.
 */
export { Actor, Pawn } from "./actors";
export type { ActorClass } from "./actors";

/**
 * Components: what an actor is assembled from.
 *
 * Everything an actor *is* beyond a transform is a component attached to it —
 * the meshes, models, lights, and raw three objects the pipeline draws in world
 * space, the sprites, shapes, text, and direct drawing it draws on the screen
 * layer, the view target the camera follows, and the collider the collision pass
 * tests.
 */
export {
  CameraComponent,
  Component,
  DrawComponent,
  LightComponent,
  MeshComponent,
  ModelComponent,
  Object3DComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
export type { ComponentClass } from "./components";

/**
 * Controllers: what drives a pawn.
 *
 * A controller is the only thing that reads input, and possession is the link
 * between the decision and the body it moves — which is what lets a pawn be
 * handed from a player to an AI without either of them knowing about the other.
 */
export { AIController, Controller, PlayerController } from "./controllers";
export type { ControllerClass } from "./controllers";

/**
 * Collision: the collider a game declares, and the queries and reports it gets
 * back.
 *
 * Detection belongs to the engine and response belongs to the game: nothing the
 * pass reports moves anything, and a manifold is the arithmetic a game needs to
 * decide what to do about a pair rather than a correction already applied.
 */
export { ColliderComponent } from "./collision";
export type { CollisionWorld, Hit, Overlap, QueryOptions } from "./collision";

/**
 * The camera and the letterboxed fit it projects into.
 *
 * The three functions are the fit itself, exported so a validator can compute
 * the same mapping the engine renders through: `fitViewport` derives it,
 * `syncCanvas` applies it to a canvas, and `applyViewport` installs it on a 2D
 * context. `Camera` is the world's own, reached as `world.camera`.
 */
export { applyViewport, fitViewport, syncCanvas } from "./camera";
export type { Camera } from "./camera";

/**
 * The whole shared vocabulary, re-exported wholesale.
 *
 * `contract.ts` *is* the package's type surface — it exists precisely so that
 * the engine, the framework classes, the built-in components, and a validator
 * cannot drift apart — and re-exporting it as a list would add another place
 * for a type to be forgotten in. The contract module holds no runtime values,
 * so nothing but types crosses.
 */
export type * from "./contract";
