/**
 * `@test-cabinet/structured-3d` — the **Structured 3D** engine: the runtime a
 * produced 3D game is built *inside*.
 *
 * Where the Simple family hands a game a loop and a scene context, this engine
 * hands it an object model and owns everything around it:
 *
 * - **The gameplay framework** — a {@link GameInstance} that outlives every
 *   level, worlds built from level descriptions, a {@link GameMode} and
 *   {@link GameState} that decide and record a match, {@link Actor}s assembled
 *   from {@link Component}s, and {@link Controller}s that possess and drive
 *   {@link Pawn}s. A build writes subclasses; the engine constructs, ticks,
 *   renders, and tears down, in a fixed order.
 * - **The frame loop and its delta time** — a replaceable clock answers how
 *   much each frame is worth, so the sequence a validator steps through
 *   synchronously is the sequence a reviewer watches play.
 * - **Rendering** — engine-owned, over WebGL2: the pipeline collects every
 *   enabled, visible render component, orders it by layer, spawn, and
 *   attachment, and lowers it onto one shared ten-verb scene context under one
 *   of four render modes, with a {@link DrawComponent} as the direct-drawing
 *   path.
 * - **Collision** — detection belongs to the engine, response to the game:
 *   channels and responses declare what is tested, events and 3D manifolds
 *   report what was found, and nothing is moved.
 * - **The canvas fit and the camera** — a letterboxed, centred,
 *   device-pixel-ratio-aware map from the logical design size onto the element,
 *   resynced every frame, with the world's perspective camera projecting world
 *   points into it.
 * - **Input** — named actions over `KeyboardEvent.code` bindings and a closed
 *   catalogue of touch layouts, read only through a player controller, with
 *   edges consumed per controller.
 * - **Audio** — cues played by name, synthesized or file-backed, decoded by
 *   the engine itself, and the first-gesture unlock a browser insists on.
 * - **Assets** — meshes, textures, materials, and sounds resolved and loaded
 *   under one fixed root, decoded in the package rather than by the platform.
 * - **Diagnostics** — an overlay of values the game names, on its own 2D
 *   surface above the WebGL canvas, its frame-time graph, and the key that
 *   toggles it.
 * - **Draw-command recording** — an opt-in flight recorder over the scene
 *   context, so a scenario a check drove replays as the operations the build
 *   issued.
 * - **The debug surface** — the value the game instance's `initialize`
 *   returns, held and handed back off the engine, so a check poses a scenario
 *   through the engine it built rather than through the page the build is
 *   drawn on.
 *
 * The package has one entry point — this module — providing `createEngine`,
 * the framework classes, the built-in components, the clocks, the math
 * functions, `TOUCH_LAYOUTS`, the viewport and projection functions,
 * `RECORDING_FORMAT`, and every type a game or a validator names; the
 * `./recording` subpath serves the recording format alone, as a leaf module
 * loadable with no engine and no DOM. Everything the engine observes it
 * broadcasts as an event a caller subscribes to, rather than accumulating a
 * log.
 *
 * ```ts
 * const engine = createEngine({ canvas, width: 640, height: 360, game });
 * await engine.initialize();
 * await engine.run({ signal: controller.signal });
 * ```
 */

import type { Actor } from "./actors";
import type { Camera as CameraOf } from "./camera";

export { createEngine } from "./engine";

export { GameInstance } from "./game-instance";
export { GameMode, GameState, PlayerState } from "./game-mode";
export { Actor, Pawn } from "./actors";
export {
  AmbientLightComponent,
  CameraComponent,
  Component,
  DirectionalLightComponent,
  DrawComponent,
  LightComponent,
  MeshComponent,
  PointLightComponent,
  RenderComponent,
  ShapeComponent,
  TextComponent,
} from "./components";
export { ColliderComponent } from "./collision";
export { AIController, Controller, PlayerController } from "./controllers";

export {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
  WallClock,
} from "./clocks";
export { TOUCH_LAYOUTS } from "./input";
export { fitViewport, pointerRay, projectPoint, syncCanvas } from "./camera";
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
export { RECORDING_FORMAT } from "./recording";

/*
 * The type surface, named module by module.
 *
 * Its 2D siblings re-export one `contract.ts` wholesale, because there every
 * shared type is declared in that one leaf. Here `contract.ts` carries the
 * recording format alone and each subsystem declares its own vocabulary beside
 * the code that upholds it, so the list is written out: a wholesale
 * `export type *` per module would also export the engine-internal seams — the
 * world driver's deps, the recorder's, the glTF chunk shapes — as though a game
 * were meant to name them. Each group below is one API page's Exports section,
 * and a name that appears on two pages is exported once, from the module that
 * declares it.
 */

/** Engine: `apis/engine.md`. `SurfaceMetrics` is declared beside the fit that reads it. */
export type { Engine, EngineOptions, RunOptions } from "./engine";
export type { SurfaceMetrics } from "./camera";
export type { EngineEventMap, EngineEvents, FrameInfo } from "./worlds";

/** Game instance: `apis/game-instance.md`. */
export type {
  GameDefinition,
  GameInstanceClass,
  InitApi,
} from "./game-instance";

/** Worlds: `apis/worlds.md`. `WorldAudio` is declared beside the bus behind it. */
export type {
  ActorSpec,
  LevelDefinition,
  LoadApi,
  SpawnSpec,
  TimerHandle,
  World,
} from "./worlds";

/** Game mode: `apis/game-mode.md`. */
export type {
  BotOptions,
  GameModeClass,
  MatchPhase,
  PlayerOptions,
} from "./game-mode";

/** Actors: `apis/actors.md`. `Transform` is one of the math types. */
export type { ActorClass, EndPlayReason } from "./actors";

/** Components: `apis/components.md`, and `DrawApi`/`SceneContext` from `apis/rendering.md`. */
export type {
  ComponentClass,
  DrawApi,
  LightOptions,
  MeshOptions,
  PointLightOptions,
  SceneContext,
  Shape3,
  ShapeOptions,
  TextOptions,
} from "./components";

/** Controllers: `apis/controllers.md`. `InputReader` is declared with the registry that hands it out. */
export type { ControllerClass } from "./controllers";

/** Rendering: `apis/rendering.md`. `RenderMode` travels with the recording format. */
export type { Renderer } from "./rendering";

/** Collision: `apis/collision.md`. `Shape3` is a component type; `ColliderComponent` a class. */
export type {
  ColliderOptions,
  CollisionResponse,
  CollisionWorld,
  Hit,
  Manifold,
  Overlap,
  QueryOptions,
} from "./collision";

/**
 * Camera: `apis/camera.md`, less the math types below.
 *
 * `Camera` is bound to `Actor` here. The class is generic over the actor type
 * — the camera is deliberately ignorant of the gameplay framework — but the
 * type a game annotates with is the concrete one the page specifies, whose
 * `target` is an `Actor`.
 */
export type Camera = CameraOf<Actor>;

/** The math vocabulary: `apis/camera.md` and `apis/actors.md`, shared verbatim with Simple 3D. */
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

/** Clocks: `apis/clocks.md`. */
export type { Clock, PacedClockOptions } from "./clocks";

/** Input: `apis/input.md`. */
export type {
  ActionBinding,
  ActionKind,
  InputReader,
  PointerSample,
  PointerSampleType,
  PointerSnapshot,
  RegisteredAction,
  TouchLayout,
} from "./input";

/** Audio: `apis/audio.md`. */
export type { AudioState, CueSpec, WorldAudio } from "./audio";

/** Assets: `apis/assets.md`. `MaterialMapSlot` travels with the recording format. */
export type { MaterialHandle, MeshHandle, TextureHandle } from "./assets";

/** Diagnostics: `apis/diagnostics.md`. */
export type { FrameMetrics } from "./diagnostics";

/**
 * Recording: `apis/recording.md`, from the leaf the `./recording` subpath
 * serves, so the two specifiers cannot drift apart.
 */
export type {
  CapturedAsset,
  Color,
  DrawOp,
  DrawValue,
  LightState,
  MaterialMapSlot,
  RecordedFrame,
  Recording,
  RenderMode,
  RenderState,
  Resource,
  ResourceOp,
} from "./contract";
