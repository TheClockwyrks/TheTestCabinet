import { describe, expect, it } from "vitest";

import * as engine from "./index";
import type {
  ActionBinding,
  ActionKind,
  ActorClass,
  ActorSpec,
  AudioState,
  Box3,
  BotOptions,
  Camera,
  CameraSnapshot,
  Clock,
  ColliderOptions,
  ColliderShape,
  CollisionResponse,
  CollisionWorld,
  ComponentClass,
  ControllerClass,
  CueSpec,
  DiagnosticReading,
  DiagnosticValue,
  DrawApi,
  Engine,
  EngineEventMap,
  EngineEvents,
  EngineOptions,
  EndPlayReason,
  FrameInfo,
  FrameMetrics,
  GameDefinition,
  GameInstanceClass,
  GameModeClass,
  Hit,
  InitApi,
  InputReader,
  LevelDefinition,
  LightSpec,
  LoadApi,
  Manifold,
  Mat4,
  MatchPhase,
  MaterialSpec,
  MeshGeometry,
  Model,
  NodeHandle,
  Overlap,
  PacedClockOptions,
  PlayOptions,
  PlayerOptions,
  PointerButton,
  PointerContact,
  PointerDevice,
  PointerSample,
  PointerSampleType,
  PointerSnapshot,
  Projected,
  Quat,
  QueryOptions,
  Ray,
  Rect,
  RecordedFrame,
  Recording,
  RegisteredAction,
  RenderMode,
  RenderSpace,
  Renderer,
  RunOptions,
  Shape2D,
  ShapeOptions,
  SpawnSpec,
  SpriteOptions,
  SurfaceMetrics,
  TextOptions,
  TimerHandle,
  TouchLayout,
  Transform,
  Vec2,
  Vec3,
  Viewport,
  WheelDelta,
  World,
  WorldAudio,
} from "./index";

/**
 * The package's entry point, checked against what the API pages say it exposes.
 *
 * The engine is imported by a produced build and by the validator that judges
 * it, and the two read the same reference pages to decide what exists. A name a
 * page promises and the entry point does not export is a build that does not
 * compile; a name the entry point exports and no page mentions is a surface the
 * package has to keep working forever without ever having said it would. This
 * suite is the one place both directions are stated, so the entry point cannot
 * drift from the documentation in either.
 *
 * The type half cannot be asserted at runtime — types are erased — so it is
 * checked by the import above and by the declarations below: a missing type
 * export fails `tsc`, not vitest, which is exactly where a build would feel it.
 */

/** Every value the API pages promise `@test-cabinet/structured-3d` exports. */
const DOCUMENTED_VALUES: readonly string[] = [
  // Actors — apis/actors.md
  "Actor",
  "Pawn",
  // Camera — apis/camera.md
  "applyViewport",
  "fitViewport",
  "syncCanvas",
  // Clocks — apis/clocks.md
  "ConstantClock",
  "JitterClock",
  "PacedClock",
  "SequenceClock",
  "WallClock",
  // Collision — apis/collision.md
  "ColliderComponent",
  // Components — apis/components.md
  "CameraComponent",
  "Component",
  "DrawComponent",
  "LightComponent",
  "MeshComponent",
  "ModelComponent",
  "Object3DComponent",
  "RenderComponent",
  "ShapeComponent",
  "SpriteComponent",
  "TextComponent",
  // Controllers — apis/controllers.md
  "AIController",
  "Controller",
  "PlayerController",
  // Engine — apis/engine.md
  "createEngine",
  // Game instance — apis/game-instance.md
  "GameInstance",
  // Game mode — apis/game-mode.md
  "GameMode",
  "GameState",
  "PlayerState",
  // Input — apis/input.md
  "TOUCH_LAYOUTS",
  // Math — apis/math.md
  "FORWARD",
  "QUAT_IDENTITY",
  "RIGHT",
  "UP",
  "VEC3_ONE",
  "VEC3_ZERO",
  "add",
  "composeTransforms",
  "cross",
  "distance",
  "dot",
  "length",
  "lerp",
  "normalize",
  "quat",
  "quatFromAxisAngle",
  "quatFromEuler",
  "quatInverse",
  "quatLookAt",
  "quatMultiply",
  "quatRotate",
  "quatSlerp",
  "quatToEuler",
  "scale",
  "sub",
  "transformPoint",
  "transformToMatrix",
  "vec3",
];

describe("the entry point's value exports", () => {
  it("exports exactly what the API pages promise, and nothing more", () => {
    expect(Object.keys(engine).sort()).toEqual([...DOCUMENTED_VALUES].sort());
  });

  it("exports the framework classes as constructible classes", () => {
    for (const name of [
      "Actor",
      "Pawn",
      "Component",
      "ColliderComponent",
      "Controller",
      "PlayerController",
      "AIController",
      "GameMode",
      "GameState",
      "PlayerState",
      "GameInstance",
    ] as const) {
      expect(typeof engine[name]).toBe("function");
      expect(engine[name].prototype).toBeDefined();
    }
  });

  it("keeps the render components on one inheritance chain", () => {
    expect(engine.MeshComponent.prototype).toBeInstanceOf(
      engine.RenderComponent,
    );
    expect(engine.RenderComponent.prototype).toBeInstanceOf(engine.Component);
    // The view target is a plain component: it declares what the camera
    // follows, and nothing about it is drawn.
    expect(engine.CameraComponent.prototype).toBeInstanceOf(engine.Component);
    expect(engine.CameraComponent.prototype).not.toBeInstanceOf(
      engine.RenderComponent,
    );
    expect(engine.ColliderComponent.prototype).toBeInstanceOf(engine.Component);
  });

  it("re-exports nothing from three", () => {
    // `three` is a peer dependency a build imports itself, so the engine, the
    // build, and the voxel runtime share one instance. A re-export here would
    // be a second door onto a second copy.
    for (const name of ["Scene", "Vector3", "Mesh", "WebGLRenderer", "THREE"]) {
      expect(name in engine).toBe(false);
    }
  });

  it("holds no engine seam a game could reach", () => {
    // Every one of these is a name a subsystem exports for the engine's own
    // wiring, and the API pages name none of them.
    for (const name of [
      "EngineWorld",
      "WorldCamera",
      "RenderPipeline",
      "CollisionSystem",
      "EngineEventBus",
      "assembleEngine",
      "bindGameMode",
      "bindGameInstance",
      "updateCamera",
      "cameraObject",
      "FrameRecorder",
      "AudioBus",
      "AssetLoader",
      "InputSystem",
      "Diagnostics",
      "domSurface",
    ]) {
      expect(name in engine).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The type half                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One declaration per documented type, so the compiler proves the entry point
 * exports it.
 *
 * `never` inhabits every one of them, so nothing here has to construct a value
 * of a type whose shape is beside the point; what is being asserted is that the
 * name resolves through `./index` at all.
 */
interface DocumentedTypes {
  actionBinding: ActionBinding;
  actionKind: ActionKind;
  actorClass: ActorClass;
  actorSpec: ActorSpec;
  audioState: AudioState;
  botOptions: BotOptions;
  box3: Box3;
  camera: Camera;
  cameraSnapshot: CameraSnapshot;
  clock: Clock;
  colliderOptions: ColliderOptions;
  colliderShape: ColliderShape;
  collisionResponse: CollisionResponse;
  collisionWorld: CollisionWorld;
  componentClass: ComponentClass;
  controllerClass: ControllerClass;
  cueSpec: CueSpec;
  diagnosticReading: DiagnosticReading;
  diagnosticValue: DiagnosticValue;
  drawApi: DrawApi;
  endPlayReason: EndPlayReason;
  engine: Engine;
  engineEventMap: EngineEventMap;
  engineEvents: EngineEvents;
  engineOptions: EngineOptions;
  frameInfo: FrameInfo;
  frameMetrics: FrameMetrics;
  gameDefinition: GameDefinition;
  gameInstanceClass: GameInstanceClass;
  gameModeClass: GameModeClass;
  hit: Hit;
  initApi: InitApi;
  inputReader: InputReader;
  levelDefinition: LevelDefinition;
  lightSpec: LightSpec;
  loadApi: LoadApi;
  manifold: Manifold;
  mat4: Mat4;
  matchPhase: MatchPhase;
  materialSpec: MaterialSpec;
  meshGeometry: MeshGeometry;
  model: Model;
  nodeHandle: NodeHandle;
  overlap: Overlap;
  pacedClockOptions: PacedClockOptions;
  playOptions: PlayOptions;
  playerOptions: PlayerOptions;
  pointerButton: PointerButton;
  pointerContact: PointerContact;
  pointerDevice: PointerDevice;
  pointerSample: PointerSample;
  pointerSampleType: PointerSampleType;
  pointerSnapshot: PointerSnapshot;
  projected: Projected;
  quat: Quat;
  queryOptions: QueryOptions;
  ray: Ray;
  recordedFrame: RecordedFrame;
  recording: Recording;
  rect: Rect;
  registeredAction: RegisteredAction;
  renderMode: RenderMode;
  renderSpace: RenderSpace;
  renderer: Renderer;
  runOptions: RunOptions;
  shape2d: Shape2D;
  shapeOptions: ShapeOptions;
  spawnSpec: SpawnSpec;
  spriteOptions: SpriteOptions;
  surfaceMetrics: SurfaceMetrics;
  textOptions: TextOptions;
  timerHandle: TimerHandle;
  touchLayout: TouchLayout;
  transform: Transform;
  vec2: Vec2;
  vec3: Vec3;
  viewport: Viewport;
  wheelDelta: WheelDelta;
  world: World;
  worldAudio: WorldAudio;
}

describe("the entry point's type exports", () => {
  it("resolves every documented type through the entry point", () => {
    // The assertion happened at compile time; this records that the block above
    // is load-bearing rather than dead code a formatter could delete.
    const documented = null as unknown as DocumentedTypes;
    expect(documented).toBeNull();
  });
});
