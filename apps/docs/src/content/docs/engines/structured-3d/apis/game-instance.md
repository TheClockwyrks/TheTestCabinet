---
title: Game Instance
---

A game definition names the level registry, the level the engine opens first,
and the game instance class. The game instance is the object that represents the
whole game: the engine constructs it once, from the class the definition names,
and keeps it for its lifetime. Every level transition happens underneath it, so
the instance is the one framework object that outlives a world.

## `GameDefinition`

```ts
interface GameDefinition<D = unknown> {
  instance?: GameInstanceClass<D>;
  levels: Readonly<Record<string, LevelDefinition>>;
  startLevel: string;
}
```

| Field        | Default        | Meaning                                                                                                |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `instance`   | `GameInstance` | The class constructed once and kept across every level. Its `initialize` fixes `D`, the debug surface. |
| `levels`     | —              | The level registry, keyed by level name. At least one entry.                                           |
| `startLevel` | —              | The level `engine.initialize` opens. A key of `levels`.                                                |

The definition is what
[`EngineOptions.game`](/engines/structured-3d/apis/engine/) carries, and one
engine drives one definition for its lifetime. Each entry of `levels` is a
[level definition](/engines/structured-3d/apis/worlds/): a description rather
than a live object. Opening one builds a world, and the definition stays
available for every later transition back to it.

`D` is the type of the [debug surface](/engines/structured-3d/concepts/debug/)
the instance's `initialize` returns, and `createEngine` infers it from the
definition. A game with no surface is a `GameDefinition<null>`.

## `GameInstance`

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

| Member         | Called                                                         |
| -------------- | -------------------------------------------------------------- |
| `initialize`   | Once, before the start level opens. Returns the debug surface. |
| `worldOpened`  | After each world's game mode has begun play.                   |
| `worldClosing` | Before each world's actors end play.                           |
| `shutdown`     | Once, from `engine.destroy`.                                   |

A game supplies its own subclass through `GameDefinition.instance`. The class
takes no constructor arguments, and the engine constructs it with none. Omitting
the field uses `GameInstance` itself, which suits a game whose whole state fits
in its worlds.

`engine` is assigned before `initialize` runs, so a constructor sets defaults
and nothing more. Anything that reads the engine, loads an asset, or registers a
binding belongs in `initialize`. `events` is the same broadcaster that
`engine.events` reaches.

The base class's `initialize` returns `null` and its other methods do nothing,
so a subclass overrides only what it needs. `initialize` may return a promise,
and the engine awaits it before the start level opens.

```ts
class Arcade extends GameInstance<null> {
  best = 0;

  override initialize(api: InitApi): null {
    api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
    return null;
  }

  override worldOpened(world: World): void {
    world.diagnostics.register("best", () => this.best);
  }
}
```

## What lives on the instance

The instance carries what must survive travel between levels: the action
bindings and cue definitions declared from `InitApi`, the assets the whole game
needs, the diagnostic sources the overlay should always show, and the figures a
game keeps across matches, such as a high score or the number of levels
completed.

A value scoped to one match lives on the
[game state](/engines/structured-3d/apis/game-mode/) instead, which is rebuilt
with its world. Score, phase, elapsed match time, and per-player figures belong
there, so a transition clears them without the instance doing anything.

`worldOpened` and `worldClosing` are where the two meet. A game reads the
outgoing world's state into the instance from `worldClosing`, and seeds the
incoming world from `worldOpened`.

## The debug surface

`initialize` returns the game's debug surface: the operations a case's checks
use to pose a situation and read it back. The engine holds the value unchanged
and hands it back as `engine.debug`, reading no member of it, so its shape is
whatever the instance declares as `D`. A game with no surface returns `null`,
and `undefined` is refused.

Each operation is a method that acts on the live world through `this.engine`.
`engine.world` follows every transition, so an operation reads it at the moment
of the call rather than holding a world of its own. A pose takes only its own
arguments and returns nothing; a reading takes nothing and returns plain data.

```ts
interface Debug {
  startMatch(mode: Mode): void;
  setBallPosition(x: number, y: number, z: number): void;
  setBallVelocity(vx: number, vy: number, vz: number): void;
  snapshot(): Snapshot;
}

class Arcade extends GameInstance<Debug> {
  override initialize(api: InitApi): Debug {
    api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
    const ball = (): Ball => this.engine.world.byTag("ball")[0] as Ball;
    return {
      startMatch: (mode) => (this.engine.world.mode as Arena).start(mode),
      setBallPosition: (x, y, z) => {
        ball().transform.position = { x, y, z };
      },
      setBallVelocity: (vx, vy, vz) => {
        ball().velocity = { x: vx, y: vy, z: vz };
      },
      snapshot: () => ({
        score: (this.engine.world.state as ArenaState).score,
      }),
    };
  }
}
```

A pose arranges the world through the same systems play uses, spawning actors,
moving transforms, driving the game mode, and possessing pawns, and leaves the
outcome to the frames that follow. The surface's shape comes from the case's
instrumentation spec; the [Debug Surface](/engines/structured-3d/concepts/debug/)
page covers what belongs on it.

## `InitApi`

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

Everything declared here belongs to the whole game and survives every level
transition: the action bindings, the cue definitions, the assets the instance
holds, and the diagnostic sources the overlay reads. `loadTexture` decodes an
image into a `THREE.Texture` a material declaration's `map` takes, and
`loadModel` decodes a glTF file into a [`Model`](/engines/structured-3d/apis/assets/)
a `ModelComponent` places; both are the same loaders `world.assets` and a
level's `LoadApi` expose.

```ts
class Arcade extends GameInstance<null> {
  ship!: Model;

  override async initialize(api: InitApi): Promise<null> {
    api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
    api.audio.define("score", { freq: 660, durationMs: 90 });
    this.ship = await api.assets.loadModel("models/ship.glb");
    return null;
  }
}
```

An asset only one level needs is loaded in that level's `load` instead, which
the engine awaits before any actor of that level exists.

## Errors

| Condition                                               | Result                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `initialize` throws or rejects                          | `engine.initialize` rejects with the cause, and no frame runs                           |
| `initialize` returns `undefined`                        | `engine.initialize` rejects with an `Error` naming the debug surface, and no frame runs |
| `engine.debug` read before `engine.initialize` resolves | `Error` naming the ordering                                                             |

## Exports

`GameInstance` is exported as a class from `@clockwyrks/structured-3d`.
`GameDefinition`, `GameInstanceClass`, and `InitApi` are exported as types from
the same specifier.
