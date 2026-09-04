# Worlds and levels

A level is a description: the game mode that runs it, the actors placed in it,
and the assets it loads. Opening a level builds a **world**, the live instance
of that description. One world is open at a time, and `engine.world` is the one
currently open. The registry a level name is looked up in, and the level the
engine opens first, are declared on the game definition; see `README.md`.

## `LevelDefinition`

```ts
interface LevelDefinition {
  mode: GameModeClass;
  actors?: readonly ActorSpec[];
  load?(api: LoadApi): void | Promise<void>;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `mode` | — | The game mode class constructed when the world is built. See `game-modes.md`. |
| `actors` | No placed actors | The actors the level places, spawned in the order given. |
| `load` | No load step | Runs before the world is built, and is awaited. Where the level's assets and cues are loaded. |

Place the scenery and the lights here and leave the pawns to the game mode: a
mode's `restart` spawns its `pawnClass` at its own spawn point, so a rover, a
ship, or a character arrives through possession rather than through the level's
list.

## `ActorSpec`

```ts
interface ActorSpec<A extends Actor = Actor> {
  type: ActorClass<A>;
  transform?: Partial<Transform>;
  tags?: readonly string[];
  configure?(actor: A): void;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `type` | — | The actor class constructed. See `actors.md`. |
| `transform` | The identity transform | Written over the constructed actor's transform, field by field. An absent field is filled from the identity; a field given is given whole. |
| `tags` | No tags | Tags carried by the actor from the moment it is attached. |
| `configure` | — | Runs on the constructed actor after the transform and the tags are applied, before it begins play. |

The identity transform is `position {0, 0, 0}`, `rotation {0, 0, 0, 1}`, and
`scale {1, 1, 1}`. A spec that gives `position` alone places the actor unrotated
at unit scale; a spec that gives `rotation` gives the whole quaternion.

`configure` receives the actor at its own type, so it sets the fields the class
declares without a cast. Every actor a level declares exists before any of their
`beginPlay` runs, so an actor finds its peers there rather than in `configure`.

```ts
import { quatFromAxisAngle, vec3, UP } from "@test-cabinet/structured-3d";
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { ArenaMode } from "./modes";
import { Goal, Rig, Wall } from "./actors";
import { CHANNELS, FIELD, TAGS } from "./constants";

export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [
    { type: Rig },
    {
      type: Wall,
      transform: { position: vec3(0, 0, -FIELD.halfDepth) },
      tags: [TAGS.wall],
      configure: (wall: Wall) => {
        wall.collider.shape = {
          kind: "box",
          width: FIELD.width,
          height: FIELD.wallHeight,
          depth: 0.5,
        };
      },
    },
    {
      type: Goal,
      transform: {
        position: vec3(-FIELD.halfWidth, 0, 0),
        rotation: quatFromAxisAngle(UP, Math.PI / 2),
      },
      tags: [TAGS.goal],
    },
  ],
  async load(api) {
    await api.audio.load("bounce", "audio/bounce.wav");
  },
};
```

## `LoadApi`

```ts
interface LoadApi {
  readonly assets: InitApi["assets"];
  readonly audio: { load(cue: string, path: string): Promise<void> };
  readonly events: EngineEvents;
}
```

| Member | Effect |
| --- | --- |
| `assets` | The asset loaders, resolving under `assetRoot`. See `assets.md`. |
| `audio` | Binds a cue name to an audio file. Cue definitions belong to the engine, so a cue loaded here survives every later transition. |
| `events` | The engine's broadcaster. |

The engine awaits `load` before any actor of the level exists, so a component
receives its image, texture, or model as a plain value. Hold what `load`
produced in a module the actors import:

```ts
// ./assets.ts
import type { Model } from "@test-cabinet/structured-3d";
import type * as THREE from "three";

export interface Loaded {
  walker: Model;
  hull: THREE.Texture;
}

let loaded: Loaded | null = null;

export function setLoaded(value: Loaded): void {
  loaded = value;
}

/** The level's assets. Throws before the level's `load` has resolved. */
export function assets(): Loaded {
  if (loaded === null) throw new Error("the arena's assets are not loaded");
  return loaded;
}
```

```ts
// in the level
async load(api) {
  const [walker, hull] = await Promise.all([
    api.assets.loadModel("models/walker.glb"),
    api.assets.loadTexture("textures/hull.png"),
  ]);
  setLoaded({ walker, hull });
}
```

An actor's constructor then reads `assets().walker` as a plain value, because
`load` resolved before any actor of the level existed. See `assets.md`.

## `World`

```ts
interface World {
  readonly level: string;
  readonly mode: GameMode;
  readonly state: GameState;
  readonly camera: Camera;
  readonly collision: CollisionWorld;
  readonly time: number;
  readonly paused: boolean;

  readonly audio: WorldAudio;
  readonly assets: InitApi["assets"];
  readonly diagnostics: {
    register(name: string, source: () => DiagnosticValue): void;
  };
  readonly events: EngineEvents;

  spawn<A extends Actor>(type: ActorClass<A>, spec?: SpawnSpec<A>): A;
  actors(): readonly Actor[];
  byTag(tag: string): readonly Actor[];
  ofType<A extends Actor>(type: ActorClass<A>): readonly A[];
  find<A extends Actor>(type: ActorClass<A>): A | null;

  controllers(): readonly Controller[];
  players(): readonly PlayerController[];

  after(seconds: number, fn: () => void): TimerHandle;
  every(seconds: number, fn: () => void): TimerHandle;
  clearTimer(handle: TimerHandle): void;

  setPaused(paused: boolean): void;
  open(level: string, options?: Readonly<Record<string, unknown>>): void;

  frame(): FrameInfo;
  viewport(): Viewport;
}
```

| Member | Semantics |
| --- | --- |
| `level` | The name the world was opened under. |
| `mode` | The game mode running this world. |
| `state` | The game state the mode built. |
| `camera` | The world's camera. See `camera.md`. |
| `collision` | The world's collision queries. See `collision.md`. |
| `time` | Seconds of simulated time the world has been stepped by. Incremented before the controllers tick. |
| `paused` | Whether the world's simulation is suspended. |
| `audio` | The cue bus this world plays through. See `audio.md`. |
| `assets` | The asset loaders, resolving under `assetRoot`. |
| `diagnostics` | The world's diagnostic registry. See `diagnostics.md`. |
| `events` | The engine's broadcaster. |
| `spawn` | Constructs the actor, applies `spec`, attaches it, and runs its `beginPlay` and each component's `beginPlay` before returning. Its first `tick` is the next frame. |
| `actors` | Every live actor, in spawn order, as a copy the caller owns. |
| `byTag` | The live actors carrying `tag`, in spawn order. |
| `ofType` | The live actors that are instances of `type`, in spawn order. |
| `find` | The first entry `ofType` would return, or `null`. |
| `controllers` | Every controller, player and AI alike, in the order they were added. |
| `players` | The player controllers alone, in index order. |
| `after` | Runs `fn` once, `seconds` of simulated world time from now. |
| `every` | Runs `fn` every `seconds` of simulated world time, until cleared or the world closes. |
| `clearTimer` | Cancels the scheduled callback the handle identifies. |
| `setPaused` | Pauses or resumes the world's simulation. A paused world still renders. |
| `open` | Requests a transition to `level`. The request is deferred to the end of the frame. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |

The world is reached as `engine.world` from outside and, from inside the
framework, through the `world` every actor, component, controller, and game mode
carries.

## Spawning at run time

```ts
interface SpawnSpec<A extends Actor = Actor> {
  transform?: Partial<Transform>;
  tags?: readonly string[];
  configure?(actor: A): void;
}
```

The three fields carry the same meaning they carry on `ActorSpec`, and `spawn`
applies them in the same order, then runs the actor's `beginPlay` immediately,
so a spawned actor is fully live by the time `spawn` returns. Spawning emits
`actor:spawned`.

```ts
import { quatRotate, scale, vec3 } from "@test-cabinet/structured-3d";

const shard = this.world.spawn(Shard, {
  transform: { position: this.transform.position },
  tags: [TAGS.debris],
  configure: (s) => {
    s.velocity = scale(quatRotate(this.transform.rotation, vec3(0, 1, 0)), 6);
  },
});
```

## Finding actors

Three lookups cover what a frame asks for. Each returns live actors in spawn
order, as a copy the caller owns.

```ts
const goals = this.world.byTag(TAGS.goal);
const balls = this.world.ofType(Ball);
const ball = this.world.find(Ball);
```

`byTag` finds by the vocabulary the build fixes in its constants module,
`ofType` and `find` are the typed lookups over the build's own classes, and
`find` returns `null` when nothing matches.

## Timers

```ts
type TimerHandle = number;
```

Timers count simulated world time, in seconds. `after` runs a callback once and
`every` repeats it, and both return a handle `clearTimer` cancels. A paused
world runs none of them, and a world's timers are cleared when it closes, so
clearing on the way out is optional; clearing explicitly is what stops a
repeating timer that has finished its job while the world stays open.

```ts
override beginPlay(): void {
  this.addPlayer({ name: "P1" });
  this.setPhase("playing");
  this.world.after(1.5, () => this.serve());
  this.countdown = this.world.every(1, () => {
    this.state.remaining -= 1;
    if (this.state.remaining === 0) this.setPhase("over");
  });
}
```

## Pausing

`world.setPaused` suspends the controller ticks, the actor and component ticks,
the timers, the collision pass, and the game mode's tick. The world still
renders, and its input frame still closes, so an edge is still consumed once.

An actor whose `tickWhenPaused` is `true` ticks anyway, together with its
components, which is how a pause menu drives itself:

```ts
import { Actor, PlayerController, TextComponent } from "@test-cabinet/structured-3d";

export class PauseMenu extends Actor {
  private player: PlayerController | null = null;

  constructor() {
    super();
    this.tickWhenPaused = true;
    this.attach(new TextComponent({ text: "paused" })).layer = 30;
  }

  override beginPlay(): void {
    this.player = this.world.players()[0] ?? null;
  }

  override tick(): void {
    if (this.player?.input.pressed("pause") === true) {
      this.world.setPaused(!this.world.paused);
    }
  }
}
```

## The transition

`world.open(level, options)` requests a transition. The request is honored once
the frame's ticks and collision are finished, before the frame renders, so the
world a tick is reading stays whole for the length of that tick. One call per
frame is honored: a second request in the same frame replaces the first.

The sequence is fixed:

1. `world:opening` is emitted, carrying the outgoing level name and the incoming
   one.
2. The instance's `worldClosing` runs.
3. The world's timers are cleared and its diagnostic sources are dropped.
4. Each controller's `endPlay("level-closed")` runs, in reverse order.
5. Each actor's components' and then each actor's `endPlay("level-closed")`
   runs, in reverse spawn order.
6. The game mode's `endPlay("level-closed")` runs.
7. `world:closed` is emitted.
8. The incoming level's `load` runs and is awaited.
9. The world is built: the game mode is constructed with `options`, then the
   game state, then the level's declared actors in order.
10. Every declared actor's `beginPlay` runs, in spawn order, after all of them
    exist.
11. The game mode's `beginPlay` runs, which is where players are added.
12. `world:opened` is emitted, then the instance's `worldOpened` runs.

A transition is asynchronous because a level's `load` is. The loop runs no frame
while one is in flight, and the canvas keeps the last frame it drew.
`engine.advance` awaits the transition before the next frame.

`options` reaches the incoming game mode as its `options` field, and is an empty
object for the start level. It is `Readonly<Record<string, unknown>>`, so a mode
narrows each value it reads and supplies a default:

```ts
override tick(): void {
  if (this.phase !== "over") return;
  this.world.open("arena", {
    round: this.round + 1,
    carried: this.state.players[0]?.score ?? 0,
  });
}
```

## What crosses a transition

| Survives | Is rebuilt |
| --- | --- |
| The game instance and its fields | The world, its game mode, and its game state |
| Action bindings, cue definitions, and instance-level assets | Every actor, component, and controller |
| Subscriptions on `engine.events` | The player states |
| Instance-level diagnostic sources | World timers and world-level diagnostic sources |
| The frame counter and accumulated simulated time | `world.time`, which restarts at zero |

The camera is part of the world, so it is rebuilt with it at the camera
defaults. The scene the pipeline maintains is emptied of the outgoing world's
objects and populated from the incoming world's render components. A value that
must survive travel lives on the game instance; a value scoped to one match
lives on the game state. See `game-modes.md`.

## Events

```ts
"world:opening": { from: string | null; to: string };
"world:closed": { level: string };
"world:opened": { level: string };
"actor:spawned": { actor: Actor };
"actor:destroyed": { actor: Actor };
```

## Errors

| Condition | Result |
| --- | --- |
| `engine.world` read before `initialize` resolves | `Error` naming the ordering |
| `world.audio.play` naming a cue that was never declared | `Error` naming the cue |

A world is reachable once `engine.initialize` resolves, which is the point at
which the start level's `load` has resolved, its actors have begun play, and its
game mode has begun play.
