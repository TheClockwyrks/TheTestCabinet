---
title: Worlds and Levels
---

A level is a description: the game mode that runs it, the actors placed in it,
and the assets it loads. Opening a level builds a world, which is the live
instance of that description. One world is open at a time, and `engine.world`
is the one currently open.

## `LevelDefinition`

```ts
interface LevelDefinition {
  mode: GameModeClass;
  actors?: readonly ActorSpec[];
  load?(api: LoadApi): void | Promise<void>;
}
```

| Field    | Default          | Meaning                                                                                            |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `mode`   | —                | The [game mode](/engines/structured-2d/apis/game-mode/) class constructed when the world is built. |
| `actors` | No placed actors | The actors the level places, spawned in the order given.                                           |
| `load`   | No load step     | Runs before the world is built, and is awaited. Where the level's assets and cues are loaded.      |

The registry a level name is looked up in, and the level the engine opens
first, are declared on the [game
definition](/engines/structured-2d/apis/game-instance/).

## `ActorSpec`

```ts
interface ActorSpec<A extends Actor = Actor> {
  type: ActorClass<A>;
  transform?: Partial<Transform>;
  tags?: readonly string[];
  configure?(actor: A): void;
}
```

| Field       | Default                                             | Meaning                                                                                            |
| ----------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `type`      | —                                                   | The [actor](/engines/structured-2d/apis/actors/) class constructed.                                |
| `transform` | `{ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }` | Written over the constructed actor's transform, field by field.                                    |
| `tags`      | No tags                                             | Tags carried by the actor from the moment it is attached.                                          |
| `configure` | —                                                   | Runs on the constructed actor after the transform and the tags are applied, before it begins play. |

Every actor a level declares exists before any of their `beginPlay` runs, so an
actor finds its peers there rather than in `configure`.

## `LoadApi`

```ts
interface LoadApi {
  readonly assets: InitApi["assets"];
  readonly audio: { load(cue: string, path: string): Promise<void> };
  readonly events: EngineEvents;
}
```

| Member   | Effect                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `assets` | The [asset loaders](/engines/structured-2d/apis/assets/), resolving under `assetRoot`.                                         |
| `audio`  | Binds a cue name to an audio file. Cue definitions belong to the engine, so a cue loaded here survives every later transition. |
| `events` | The engine's broadcaster.                                                                                                      |

The engine awaits `load` before any actor of the level exists, so a component
receives its image as a plain value.

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

| Member        | Semantics                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`       | The name the world was opened under.                                                                                                                                            |
| `mode`        | The game mode running this world.                                                                                                                                               |
| `state`       | The game state the mode built.                                                                                                                                                  |
| `camera`      | The world's [camera](/engines/structured-2d/apis/camera/).                                                                                                                      |
| `collision`   | The world's [collision](/engines/structured-2d/apis/collision/) queries and reported pairs.                                                                                     |
| `time`        | Seconds of simulated time the world has been stepped by. Incremented before the controllers tick.                                                                               |
| `paused`      | Whether the world's simulation is suspended.                                                                                                                                    |
| `audio`       | The cue bus this world plays through.                                                                                                                                           |
| `assets`      | The asset loaders, resolving under `assetRoot`.                                                                                                                                 |
| `diagnostics` | The world's diagnostic registry.                                                                                                                                                |
| `events`      | The engine's broadcaster.                                                                                                                                                       |
| `spawn`       | Constructs the actor, applies `spec`, attaches it to the world, and runs its `beginPlay` and each component's `beginPlay` before returning. Its first `tick` is the next frame. |
| `actors`      | Every live actor, in spawn order, as a copy the caller owns.                                                                                                                    |
| `byTag`       | The live actors carrying `tag`, in spawn order.                                                                                                                                 |
| `ofType`      | The live actors that are instances of `type`, in spawn order.                                                                                                                   |
| `find`        | The first entry `ofType` would return, or `null`.                                                                                                                               |
| `controllers` | Every [controller](/engines/structured-2d/apis/controllers/), player and AI alike, in the order they were added.                                                                |
| `players`     | The player controllers alone, in index order.                                                                                                                                   |
| `after`       | Runs `fn` once, `seconds` of simulated world time from now.                                                                                                                     |
| `every`       | Runs `fn` every `seconds` of simulated world time, until cleared or the world closes.                                                                                           |
| `clearTimer`  | Cancels the scheduled callback the handle identifies.                                                                                                                           |
| `setPaused`   | Pauses or resumes the world's simulation. A paused world still renders.                                                                                                         |
| `open`        | Requests a transition to `level`. The request is deferred to the end of the frame.                                                                                              |
| `frame`       | The frame counter, the accumulated simulated time, and the most recent delta.                                                                                                   |
| `viewport`    | The current logical-to-device fit, as a snapshot the caller owns.                                                                                                               |

`world.diagnostics.register` registers a source that lives as long as the world
and is dropped when the world closes. The game instance's sources persist across
every transition.

## `SpawnSpec`

```ts
interface SpawnSpec<A extends Actor = Actor> {
  transform?: Partial<Transform>;
  tags?: readonly string[];
  configure?(actor: A): void;
}
```

The three fields carry the same meaning they carry on `ActorSpec`, and `spawn`
applies them in the same order. `spawn` then runs the actor's `beginPlay`
immediately, so a spawned actor is fully live by the time `spawn` returns.

## `TimerHandle`

```ts
type TimerHandle = number;
```

A handle identifies one scheduled callback, and `clearTimer` is what it is for.
Timers count simulated world time, so a paused world runs none of them, and a
world's timers are cleared when it closes.

## `WorldAudio`

```ts
interface WorldAudio {
  play(cue: string): void;
  loop(cue: string): void;
  stop(cue: string): void;
  looping(cue: string): boolean;
  setMuted(muted: boolean): void;
  muted(): boolean;
}
```

| Member     | Effect                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play`     | Emits `cue:played` and, when audible, sounds the [cue](/engines/structured-2d/apis/audio/). Playing a cue that was never declared throws, naming the cue. |
| `loop`     | Starts the cue looping if it is not already, emitting `cue:looped` once. Throws for an undeclared cue.                                                    |
| `stop`     | Stops the cue's loop if it is looping, emitting `cue:stopped` once. Throws for an undeclared cue.                                                         |
| `looping`  | Whether the cue is looping. `false` for an undeclared cue.                                                                                                |
| `setMuted` | Sets the mute bit. A muted cue still emits its event, reporting `gain: 0`, and every running loop follows the bit live.                                   |
| `muted`    | The current mute bit.                                                                                                                                     |

## Pausing

Pausing a world suspends the controller ticks, the actor and component ticks,
the timers, the collision pass, and the game mode's tick. The world still
renders, and its input frame still closes, so an edge is still consumed once.

An actor whose `tickWhenPaused` is `true` ticks anyway, together with its
components, which is how a pause menu drives itself.

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
object for the start level.

## What crosses a transition

| Survives                                                    | Is rebuilt                                      |
| ----------------------------------------------------------- | ----------------------------------------------- |
| The game instance and its fields                            | The world, its game mode, and its game state    |
| Action bindings, cue definitions, and instance-level assets | Every actor, component, and controller          |
| Subscriptions on `engine.events`                            | The player states                               |
| Instance-level diagnostic sources                           | World timers and world-level diagnostic sources |
| The frame counter and accumulated simulated time            | `world.time`, which restarts at zero            |

The camera is part of the world, so it is rebuilt with it. A value that must
survive travel lives on the [game
instance](/engines/structured-2d/apis/game-instance/); a value scoped to one
match lives on the game state.

## Errors

| Condition                                               | Result                      |
| ------------------------------------------------------- | --------------------------- |
| `engine.world` read before `initialize` resolves        | `Error` naming the ordering |
| `world.audio.play` naming a cue that was never declared | `Error` naming the cue      |

A world is reachable once `engine.initialize` resolves, which is the point at
which the start level's `load` has resolved, its actors have begun play, and its
game mode has begun play.

## Exports

`LevelDefinition`, `ActorSpec`, `LoadApi`, `World`, `SpawnSpec`, `TimerHandle`,
and `WorldAudio` are exported as types from `@clockwyrks/structured-2d`.
