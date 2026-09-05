# Structured 3D

`@clockwyrks/structured-3d` is the runtime a 3D browser game is built inside.
Where a minimal engine hands a game a loop and a renderer, this one hands it an
object model and owns everything around it: the frame loop, engine-owned
rendering over three.js with the 2D screen layer composited over it, volumetric
collision detection, the camera and the canvas fit, input, audio, asset loading,
the debug overlay, the recorder, and the debug surface a game returns for its
caller. The game writes subclasses — its actors, its components, its
controllers, its game modes — and the engine constructs, ticks, renders, and
tears them down in a fixed order.

## What each side owns

The engine owns:

- The frame loop and the clock that decides what each frame's delta time is.
- Canvas sizing: the letterbox, the centring, and the device pixel ratio.
- The `THREE.WebGLRenderer` over the canvas and the `THREE.Scene` the pipeline
  maintains from the world's render components.
- The camera whose frustum projects world units into the logical design field.
- The screen layer: a second, engine-owned 2D canvas, cleared and given the
  logical viewport transform every frame and composited over the 3D picture.
- The rendering pipeline: syncing each world-space component's three object,
  ordering the screen-space components by layer, and drawing both under one of
  four render modes.
- Collision detection: finding pairs, reporting them with a manifold, and the
  queries. It moves nothing.
- Keyboard listening, action binding, edge detection, and pointer tracking.
- The Web Audio graph, cue synthesis, positional playback, looping, mute, and
  the first-gesture unlock.
- Asset URL resolution under the fixed `assets/` root, and the image, texture,
  glTF, and audio decoders.
- The diagnostics registries, the overlay they are drawn on, and its toggle key.
- The recorder that captures the frames the pipeline drew, as video.
- The debug surface the game instance returned, held for a caller to read back.

The game supplies:

- A `GameDefinition`: its level registry, the level to open first, and its game
  instance class.
- Its game modes, actors, components, and controllers, as subclasses of the
  framework classes.
- Its action registrations, cue definitions, assets, and diagnostic sources.
- Its debug surface, and the shape that surface has. See `debug.md`.

## Install and import

The engine is an ordinary dependency, already present in the workspace's
`package.json`. Everything comes from one entry point: the factory, the
framework classes, the built-in components, the clock catalogue, the touch
layout catalogue, the viewport functions, the math helpers, and every type a
game names.

```ts
import {
  Actor,
  GameInstance,
  GameMode,
  MeshComponent,
  PacedClock,
  createEngine,
  vec3,
} from "@clockwyrks/structured-3d";
import type {
  Engine,
  GameDefinition,
  InitApi,
} from "@clockwyrks/structured-3d";
```

## `three` is the build's own

`three` is a **peer dependency** of the engine. The build declares it in its own
`package.json` beside the engine and imports it directly wherever it needs a
three object:

```ts
import * as THREE from "three";
```

The engine re-exports nothing from `three`, so the objects that cross the seam —
a `THREE.Texture` on a material spec, a `THREE.BufferGeometry` on a custom mesh,
the subtree an `Object3DComponent` carries, the scene the pipeline maintains —
are the build's own instance's classes, and an `instanceof` check against the
build's import holds.

Everything else a game touches — transforms, vectors, quaternions, colliders,
the camera — is a plain record or an engine object, so most files of a build
import nothing from `three` at all.

## A game is a definition

```ts
interface GameDefinition<D = unknown> {
  instance?: GameInstanceClass<D>;
  levels: Readonly<Record<string, LevelDefinition>>;
  startLevel: string;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `instance` | `GameInstance` | The class constructed once and kept across every level. Its `initialize` fixes `D`, the debug surface. |
| `levels` | — | The level registry, keyed by level name. At least one entry. |
| `startLevel` | — | The level `engine.initialize` opens. A key of `levels`. |

A level is a description: the game mode that runs it, the actors placed in it,
and the assets it loads. Opening a level builds a **world**, the live instance
of that description, and one world is open at a time. The **game instance** is
the one framework object that outlives a level transition, so a value that must
survive travel lives there; a value scoped to one match lives on the world's
game state. See `worlds.md` and `game-modes.md`.

The instance's `initialize` is where everything that belongs to the whole game
is declared: the action bindings, the cue definitions, the assets the instance
holds, and the diagnostic sources the overlay always shows. It returns the debug
surface a caller drives the build through, or `null` for a game with none.

```ts
interface InitApi {
  readonly input: {
    register(name: string, binding: ActionBinding): void;
    layout(): TouchLayout | null;
  };
  readonly audio: {
    define(cue: string, spec: CueSpec): void;
    load(cue: string, path: string): Promise<void>;
  };
  readonly assets: {
    loadImage(path: string): Promise<ImageBitmap>;
    loadTexture(path: string): Promise<THREE.Texture>;
    loadModel(path: string): Promise<Model>;
    loadAudio(path: string): Promise<AudioBuffer>;
    load(path: string): Promise<Blob>;
    resolve(path: string): string;
  };
  readonly diagnostics: {
    register(name: string, source: () => DiagnosticValue): void;
  };
  readonly events: EngineEvents;
  viewport(): Viewport;
}
```

What a single level needs it loads in its own `load`, which the engine awaits
before any actor of that level exists. See `assets.md`.

## Creating the engine

```ts
function createEngine<D = unknown>(options: EngineOptions<D>): Engine<D>;

interface EngineOptions<D = unknown> {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  game: GameDefinition<D>;
  background?: string;
  imageSmoothing?: boolean;
  layout?: string;
  clock?: Clock;
  surface?: SurfaceMetrics;
  assetRoot?: string;
  screen?: HTMLCanvasElement;
  shadows?: boolean;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | — | The stage canvas the engine sizes, clears, and renders the scene through. |
| `width` | — | The logical design width the camera projects into. Finite and positive. |
| `height` | — | The logical design height the camera projects into. Finite and positive. |
| `game` | — | The game definition, bound for the engine's lifetime. `D` is inferred from it. |
| `background` | — | A CSS color the whole canvas is cleared to before every frame, letterbox bars included. Absent, the frame clears to transparency. |
| `imageSmoothing` | `true` | Whether an image the fit scales on the screen layer is resampled bilinearly. `false` samples nearest-neighbor, which keeps pixel art crisp. See `rendering.md`. |
| `layout` | — | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. See `input.md`. |
| `clock` | `new WallClock()` | The clock supplying each frame's delta. See `frame.md`. |
| `surface` | Read from the canvas | Where the engine reads element size and device pixel ratio, and attaches its listeners. |
| `assetRoot` | `"assets/"` | The root every asset path resolves under. See `assets.md`. |
| `screen` | Created from the stage canvas's owning document | The 2D canvas the screen layer draws on. See `rendering.md`. |
| `shadows` | `false` | `true` enables shadow maps with soft (PCF) filtering, so a light declared with `castShadow` shadows a mesh declared with `receiveShadow`. |

`width` and `height` are the logical design field the camera projects into, and
they stay fixed for the life of the build. They also fix the picture's aspect:
the engine holds the camera's aspect at `width / height` and the letterbox bars
absorb whatever difference the element's own shape has. State every HUD
coordinate in those units.

**The world is a separate scale.** Every position, speed, size, and distance an
actor states is in world units, and the camera's projection relates the two. A
landscape game is comfortable at `640 × 360` with a court a few world units
across. A world's camera starts at `(0, 0, 10)` looking along `-Z` at the origin
with a `60`-degree vertical field of view, so a mesh at the origin is in view
before the game moves anything.

Construction performs no loading and runs no game code. It validates, builds the
subsystems, and returns, which is what lets a caller subscribe to
`engine.events` before anything the game does is observable. It does obtain the
renderer's `webgl2` context and the screen layer's canvas, so a canvas that
cannot supply either is refused here.

## The engine

```ts
interface Engine<D = unknown> {
  readonly events: EngineEvents;
  readonly instance: GameInstance<D>;
  readonly world: World;
  readonly renderer: Renderer;
  readonly scene: THREE.Scene;
  readonly debug: D;
  initialize(): Promise<GameInstance<D>>;
  run(options?: RunOptions): Promise<void>;
  advance(frames: number): Promise<void>;
  setClock(clock: Clock): void;
  frame(): FrameInfo;
  viewport(): Viewport;
  diagnostics(): readonly DiagnosticReading[];
  recording(): boolean;
  startRecording(): void;
  stopRecording(): Promise<Recording>;
  destroy(): void;
}
```

| Member | Effect |
| --- | --- |
| `events` | Subscribe to engine events. Available from construction. |
| `instance` | The game instance, live. |
| `world` | The world currently open, live. It follows every transition. |
| `renderer` | The rendering pipeline: its mode and its collision overlay. See `rendering.md`. |
| `scene` | The `THREE.Scene` the pipeline maintains, live. Available from construction. The pipeline writes it; a caller reads it. |
| `debug` | The debug surface the instance's `initialize` returned. See `debug.md`. |
| `initialize` | Construct the game instance, run its `initialize`, open `startLevel`, and resolve to the instance. |
| `run` | Drive frames off the host's frame callback until the signal aborts. |
| `advance` | Tick the clock `frames` times, running a frame for each tick it accepts. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `diagnostics` | Every registered diagnostic source and what it reports now, the instance registry's first and then the world's. See `diagnostics.md`. |
| `recording` | Whether the recorder is capturing frames. See `recording.md`. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm, flush the encoder, and resolve with everything captured since `startRecording`. |
| `destroy` | Close the world, halt the loop, drop every listener, discard an armed capture, and dispose the renderer. |

`initialize` resolving means the instance exists and has run its `initialize`,
the start level's `load` has resolved, its actors are spawned and have begun
play, and its game mode has begun play. The engine runs no frame before it
resolves, so no tick observes a half-constructed world. Calling it a second time
resolves to the instance already built.

Reading `instance`, `world`, or `debug` before `initialize` resolves throws,
naming the ordering.

## One event broadcaster

Everything the engine observes it broadcasts as an event rather than
accumulating a log: asset loads, cue plays, world transitions, spawns and
destroys, possession changes, match phases, and collision pairs. One broadcaster
carries all of them, reachable as `engine.events`, as `world.events`, and as the
`events` field on each API object the framework hands the game.

```ts
const off = engine.events.on("world:opened", (event) => {
  console.info(`level ${event.level} is live`);
});
```

`on` returns the function that removes the handler. Handlers run synchronously
at the moment the event happens, and a handler that throws is contained: the
error reaches the console and the remaining handlers still run. Subscriptions
live on the engine, so one made before `engine.initialize` observes the start
level being built and every transition after it. The full event map is listed
where each subsystem is documented.

## The shape of a build

A complete game: one actor that drifts and reflects off two limits, a light rig,
one game mode with no rules of its own, one level placing both, and the boot.

```ts
import {
  Actor,
  GameMode,
  LightComponent,
  MeshComponent,
  createEngine,
  vec3,
} from "@clockwyrks/structured-3d";
import type { GameDefinition } from "@clockwyrks/structured-3d";

const LIMIT = 6;
const SPEED = 4;

class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 1, height: 1, depth: 1 },
        material: { color: "#7fd1ff", roughness: 0.4 },
      }),
    );
  }

  override tick(dt: number): void {
    const at = this.transform.position;
    const x = at.x + this.vx * dt;

    if (x < -LIMIT) this.vx = SPEED;
    else if (x > LIMIT) this.vx = -SPEED;

    this.transform.position = vec3(Math.max(-LIMIT, Math.min(LIMIT, x)), 0, 0);
  }
}

class Rig extends Actor {
  constructor() {
    super();
    this.attach(new LightComponent({ light: { kind: "ambient", intensity: 0.6 } }));
    this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    ).offset.position = vec3(4, 8, 6);
  }
}

class DriftMode extends GameMode {}

const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [{ type: Rig }, { type: Drifter, transform: { position: vec3(0, 0, 0) } }],
    },
  },
  startLevel: "drift",
};

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game: drifter,
  background: "#101018",
});

await engine.initialize();
await engine.run();
```

The definition omits `instance`, so the engine constructs the base
`GameInstance`, which returns `null` for its surface — the right shape for a
game that registers no bindings and keeps nothing across levels. A game that
does declares its own subclass. `dt` is **seconds**: every speed a game writes
down is per second, and seconds are what a tick multiplies by.

The scene starts with no light, so a `standard` or `lambert` material renders
black until an actor carries a `LightComponent`. See `rendering.md`.

## Sizing the canvas

Give the canvas a CSS size and leave its `width` and `height` attributes alone:

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine reads the laid-out size at the top of every frame and resizes both
backing stores — the stage canvas and the screen canvas — to match the device
pixel ratio, so a window resize needs no handler and no code in the game. The
screen canvas the engine creates stays off the page; the 3D picture and the HUD
reach the stage canvas together. The fit and the camera's projection are covered
in `camera.md`.

## Tearing down

A game that runs for the life of the page never needs teardown. Two separate
acts stop one that does. An `AbortSignal` passed to `run` halts the loop and
leaves the engine usable:

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

`engine.destroy()` closes the world — ending play for its controllers, actors,
and game mode — then runs the instance's `shutdown`, halts the loop, detaches
every listener, and disposes the renderer. It is idempotent, and it resolves any
promise `run` returned.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| The canvas yields no `webgl2` context | `Error` naming the canvas |
| No `screen` canvas supplied and the stage canvas has no owning document | `Error` naming `screen` |
| The `screen` canvas yields no 2D context | `Error` naming `screen` |
| A `layout` outside `TOUCH_LAYOUTS` | `Error` naming every valid layout |
| `levels` with no entries | `Error` |
| `startLevel` naming no entry of `levels` | `Error` naming every registered level |
| The instance's `initialize`, a level's `load`, or a `beginPlay` throws | `initialize` rejects with the cause |
| The instance's `initialize` returns `undefined` | `initialize` rejects with an `Error` naming the debug surface |
| `instance`, `world`, `debug`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| `startRecording` while already recording, or `stopRecording` while not | `Error` naming the unbalanced call |
| `startRecording` where the host has no `VideoEncoder` | `Error` naming WebCodecs |

The construction refusals are raised in that order, so a build that would run
and draw nothing is refused where the mistake is.

## The rest of these pages

| Page | Covers |
| --- | --- |
| `math.md` | `Vec3`, `Quat`, `Transform`, the constants, and the vector, quaternion, and transform helpers. |
| `frame.md` | The loop, the fixed frame order, the clocks, `run` and `advance`, and `FrameInfo`. |
| `worlds.md` | Levels, opening a world, spawning, finding actors, timers, pausing, and the transition sequence. |
| `game-modes.md` | Writing a mode's rules, phases, players and bots, and the game and player states. |
| `actors.md` | Actors, transforms, tags, the lifecycle, the deferred destroy, and pawns. |
| `components.md` | Components and the built-in mesh, model, light, object, sprite, shape, text, draw, and camera components. |
| `controllers.md` | Controllers, possession, and driving the same pawn from a player or a bot. |
| `rendering.md` | The two passes, the scene the pipeline maintains, lights, shadows, the render modes, the screen layer, and direct drawing. |
| `camera.md` | The three coordinate spaces, the camera, following, bounds, picking with a ray, and the viewport fit. |
| `collision.md` | Colliders, channels and responses, the collision events, the manifold, and the queries. |
| `input.md` | Actions, key bindings, edges, the pointer, the wheel, and the touch layout catalogue. |
| `audio.md` | Cue definition, file-backed cues, positional playback, looping, mute, and the unlock. |
| `assets.md` | The asset root, the loaders, textures, models, the path rules, and the load events. |
| `models-and-animation.md` | Placing a glTF model, playing its clips, seeking, and driving a named node. |
| `diagnostics.md` | The two registries, reading them back, the overlay, and frame metrics. |
| `debug.md` | Declaring a debug surface, returning it from `initialize`, and driving it through `engine.debug`. |
| `recording.md` | Arming the recorder and the video it hands back. |
