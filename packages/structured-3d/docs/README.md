# Structured 3D

`@test-cabinet/structured-3d` is the runtime a 3D browser game is built inside.
Where a minimal engine hands a game a loop and a scene context, this one hands
it an object model and owns everything around it: the frame loop, WebGL2
rendering, collision detection, the camera and the canvas fit, input, audio,
asset loading, the debug overlay, and the debug surface a game returns for its
caller. The game writes subclasses — its actors, its components, its
controllers, its game modes — and the engine constructs, ticks, renders, and
tears them down in a fixed order.

## What each side owns

The engine owns:

- The frame loop and the clock that decides what each frame's delta time is.
- Canvas sizing: the letterbox, the centring, and the device pixel ratio.
- The perspective camera and its projection from world space into the logical
  design field.
- The rendering pipeline: collecting render components, ordering them by layer,
  lowering them onto one scene context, and drawing them under one of four
  render modes.
- Collision detection over volumetric shapes: finding pairs, reporting them
  with a 3D manifold, and the queries. It moves nothing.
- Keyboard listening, action binding, edge detection, and pointer tracking.
- The audio graph, cue synthesis, looping, mute, and the first-gesture unlock.
- Asset resolution and decoding under the fixed `assets/` root — meshes,
  textures, materials, and audio, decoded by the package rather than the
  platform.
- The diagnostics overlay and its toggle key.
- The draw-command recorder over the scene context the pipeline draws through.
- The debug surface the game instance returned, held for a caller to read back.

The game supplies:

- A `GameDefinition`: its level registry, the level to open first, and its game
  instance class.
- Its game modes, actors, components, and controllers, as subclasses of the
  framework classes.
- Its action registrations, cue definitions, assets, and diagnostic sources.
- Its debug surface, and the shape that surface has. See `debug.md`.

The game never writes a shader and never touches the WebGL context. The scene
context is the whole drawing vocabulary, and the pipeline is what issues it.

## Install and import

The engine is an ordinary dependency, already present in the workspace's
`package.json`. Everything comes from one entry point: the factory, the
framework classes, the built-in components, the clock catalogue, the touch
layout catalogue, the math and viewport functions, and every type a game names.

```ts
import {
  Actor,
  GameInstance,
  GameMode,
  PacedClock,
  ShapeComponent,
  createEngine,
} from "@test-cabinet/structured-3d";
import type {
  Engine,
  GameDefinition,
  InitApi,
} from "@test-cabinet/structured-3d";
```

A second specifier, `@test-cabinet/structured-3d/recording`, serves
`RECORDING_FORMAT` and the recording format's types on their own, as a leaf
module loadable with no engine and no DOM. See `recording.md`.

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

## The game instance

```ts
type GameInstanceClass<D = unknown> = new () => GameInstance<D>;

class GameInstance<D = unknown> {
  readonly engine: Engine<D>;
  readonly events: EngineEvents;
  initialize(api: InitApi): D | Promise<D>;
  worldOpened(world: World): void;
  worldClosing(world: World): void;
  shutdown(): void;
}
```

| Member | Called |
| --- | --- |
| `initialize` | Once, before the start level opens. Returns the debug surface. |
| `worldOpened` | After each world's game mode has begun play. |
| `worldClosing` | Before each world's actors end play. |
| `shutdown` | Once, from `engine.destroy`. |

The class takes no constructor arguments, and `engine` is assigned before
`initialize` runs, so a constructor sets defaults and nothing more. The base
class's `initialize` returns `null` and its other methods do nothing, so a
subclass overrides only what it needs, and `initialize` may return a promise the
engine awaits before the start level opens. `worldOpened` and `worldClosing` are
where the instance and the world meet: a game reads the outgoing world's state
into the instance from `worldClosing`, and seeds the incoming world from
`worldOpened`.

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
    loadMesh(path: string): Promise<MeshHandle>;
    loadTexture(path: string): Promise<TextureHandle>;
    loadMaterial(path: string): Promise<MaterialHandle>;
    loadAudio(path: string): Promise<AudioBuffer>;
    load(path: string): Promise<Blob>;
    resolve(path: string): string;
  };
  readonly diagnostics: {
    register(name: string, source: () => unknown): void;
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
  layout?: string;
  clock?: Clock;
  surface?: SurfaceMetrics;
  assetRoot?: string;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | — | The canvas the engine sizes, clears, and renders through. |
| `width` | — | The logical design width the camera's frustum projects into. Finite and positive. |
| `height` | — | The logical design height the camera's frustum projects into. Finite and positive. |
| `game` | — | The game definition, bound for the engine's lifetime. `D` is inferred from it. |
| `background` | — | A CSS color cleared to before every frame. Absent, the frame clears to transparency. |
| `layout` | — | A touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers. See `input.md`. |
| `clock` | `new WallClock()` | The clock supplying each frame's delta. See `frame.md`. |
| `surface` | Read from the canvas | Where the engine reads element size and device pixel ratio, and attaches its listeners. |
| `assetRoot` | `"assets/"` | The root every asset path resolves under. See `assets.md`. |

`width` and `height` are the logical design field the camera projects into, and
they stay fixed for the life of the build. Their ratio fixes the frustum's
aspect, `width / height`, so the picture is the same on every canvas the
viewport letterboxes it onto.

**World units are the game's own and never coincide with logical units.** A
world's camera starts at `(0, 0, 10)` looking down −Z with a `Math.PI / 3`
vertical field of view, and the projection is the one map between the two
spaces. State every speed, size, and distance in world units of one scale the
game chooses; the engine fits the field onto whatever size the page gives the
canvas.

Construction performs no loading and runs no game code. It validates, builds the
subsystems, and returns, which is what lets a caller subscribe to
`engine.events` before anything the game does is observable.

## The engine

```ts
interface Engine<D = unknown> {
  readonly events: EngineEvents;
  readonly instance: GameInstance<D>;
  readonly world: World;
  readonly renderer: Renderer;
  readonly debug: D;
  initialize(): Promise<GameInstance<D>>;
  run(options?: RunOptions): Promise<void>;
  advance(frames: number): Promise<void>;
  setClock(clock: Clock): void;
  frame(): FrameInfo;
  viewport(): Viewport;
  recording(): boolean;
  startRecording(): void;
  stopRecording(): Recording;
  destroy(): void;
}
```

| Member | Effect |
| --- | --- |
| `events` | Subscribe to engine events. Available from construction. |
| `instance` | The game instance, live. |
| `world` | The world currently open, live. It follows every transition. |
| `renderer` | The rendering pipeline: its mode and its collision overlay. See `rendering.md`. |
| `debug` | The debug surface the instance's `initialize` returned. See `debug.md`. |
| `initialize` | Construct the game instance, run its `initialize`, open `startLevel`, and resolve to the instance. |
| `run` | Drive frames off the host's frame callback until the signal aborts. |
| `advance` | Tick the clock `frames` times, running a frame for each tick it accepts. |
| `setClock` | Replace the clock. The next frame takes its delta from the new one. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `recording` | Whether draw-command recording is currently capturing. See `recording.md`. |
| `startRecording` | Arm the recorder. Capture begins at the next frame. |
| `stopRecording` | Disarm and return everything captured since `startRecording`. |
| `destroy` | Close the world, halt the loop, and drop every listener. |

`initialize` resolving means the instance exists and has run its `initialize`,
the start level's `load` has resolved, its actors are spawned and have begun
play, and its game mode has begun play. The engine runs no frame before it
resolves, so no tick observes a half-constructed world. Calling it a second
time resolves to the instance already built.

Reading `instance`, `world`, or `debug` before `initialize` resolves throws,
naming the ordering.

## One event broadcaster

Everything the engine observes it broadcasts as an event rather than
accumulating a log: asset loads, cue plays, world transitions, spawns and
destroys, possession changes, match phases, and collision pairs. One broadcaster
carries all of them, reachable as `engine.events`, as `world.events`, and as
the `events` field on each API object the framework hands the game.

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

A complete game: one actor that drifts a spinning box between two bounds, one
game mode with no rules of its own, one level placing the actor, and the boot.

```ts
import {
  Actor,
  GameMode,
  ShapeComponent,
  createEngine,
  quatFromAxisAngle,
  quatMultiply,
} from "@test-cabinet/structured-3d";
import type { GameDefinition } from "@test-cabinet/structured-3d";

const SIZE = 1.5;
const SPEED = 4;
const LIMIT = 8;
const TURN = Math.PI / 2;
const UP = { x: 0, y: 1, z: 0 };

class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: SIZE, y: SIZE, z: SIZE } },
        color: "#7fd1ff",
      }),
    );
  }

  override tick(dt: number): void {
    const p = this.transform.position;
    p.x += this.vx * dt;

    if (p.x < -LIMIT) {
      p.x = -2 * LIMIT - p.x;
      this.vx = SPEED;
    } else if (p.x > LIMIT) {
      p.x = 2 * LIMIT - p.x;
      this.vx = -SPEED;
    }

    this.transform.rotation = quatMultiply(
      quatFromAxisAngle(UP, TURN * dt),
      this.transform.rotation,
    );
  }
}

class DriftMode extends GameMode {}

const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [{ type: Drifter }],
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
  background: "#05060a",
});

await engine.initialize();
await engine.run();
```

The definition omits `instance`, so the engine constructs the base
`GameInstance`, which returns `null` for its surface — the right shape for a
game that registers no bindings and keeps nothing across levels. A game that
does declares its own subclass. `dt` is **seconds**: every speed a game writes
down is per second, and seconds are what a tick multiplies by. The actor's spec
names no transform, so it begins at the identity, at the world origin, in front
of the camera's default position; the level holds no light component, so the
engine's default rig lights the box.

## Sizing the canvas

Give the canvas a CSS size and leave its `width` and `height` attributes alone:

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine reads the laid-out size at the top of every frame and resizes the
backing store to match the device pixel ratio, so a window resize needs no
handler and no code in the game. The fit and the camera's projection are covered
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
and game mode — then runs the instance's `shutdown`, halts the loop, and
detaches every listener. It is idempotent, and it resolves any promise `run`
returned.

## Errors

| Condition | Result |
| --- | --- |
| A `width` or `height` that is not finite and positive | `Error` naming the size |
| A canvas that yields no WebGL2 context | `Error` |
| A `layout` outside `TOUCH_LAYOUTS` | `Error` naming every valid layout |
| `levels` with no entries | `Error` |
| `startLevel` naming no entry of `levels` | `Error` naming every registered level |
| The instance's `initialize`, a level's `load`, or a `beginPlay` throws | `initialize` rejects with the cause |
| The instance's `initialize` returns `undefined` | `initialize` rejects with an `Error` naming the debug surface |
| `instance`, `world`, `debug`, `run`, or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| `startRecording` while already recording, or `stopRecording` while not | `Error` naming the unbalanced call |

Each construction failure otherwise presents as a build that runs and draws
nothing, which is the most expensive kind to trace, so each is refused where it
happens.

## The rest of these pages

| Page | Covers |
| --- | --- |
| `frame.md` | The loop, the fixed frame order, the clocks, `run` and `advance`, and `FrameInfo`. |
| `worlds.md` | Levels, opening a world, spawning, finding actors, timers, pausing, and the transition sequence. |
| `game-modes.md` | Writing a mode's rules, phases, players and bots, and the game and player states. |
| `actors.md` | Actors, transforms, tags, the lifecycle, the deferred destroy, and pawns. |
| `components.md` | Components and the built-in render, mesh, shape, text, draw, camera, and light components. |
| `controllers.md` | Controllers, possession, and driving the same pawn from a player or a bot. |
| `rendering.md` | The pipeline, the ordering, the render modes, the scene context, and direct drawing. |
| `camera.md` | The three coordinate spaces, the math vocabulary, the camera, following, projection, and the viewport fit. |
| `collision.md` | Colliders, channels and responses, the collision events, the manifold, and the queries. |
| `input.md` | Actions, key bindings, edges, the pointer, and the touch layout catalogue. |
| `audio.md` | Cue definition, file-backed cues, playback, looping, mute, and the unlock. |
| `assets.md` | The asset root, the four loaders, the handles, the path rules, and the load events. |
| `diagnostics.md` | The overlay, the two registries, frame metrics, and the display formatting. |
| `debug.md` | Declaring a debug surface, returning it from `initialize`, and driving it through `engine.debug`. |
| `recording.md` | Arming the recorder, the recording format, and replaying a frame. |
