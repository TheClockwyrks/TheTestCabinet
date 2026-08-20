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
interface GameDefinition {
  instance?: GameInstanceClass;
  levels: Readonly<Record<string, LevelDefinition>>;
  startLevel: string;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `instance` | `GameInstance` | The class constructed once and kept across every level. |
| `levels` | — | The level registry, keyed by level name. At least one entry. |
| `startLevel` | — | The level `engine.initialize` opens. A key of `levels`. |

The definition is what
[`EngineOptions.game`](/engines/structured-2d/apis/engine/) carries, and one
engine drives one definition for its lifetime. Each entry of `levels` is a
[level definition](/engines/structured-2d/apis/worlds/): a description rather
than a live object. Opening one builds a world, and the definition stays
available for every later transition back to it.

## `GameInstance`

```ts
type GameInstanceClass = new () => GameInstance;

class GameInstance {
  readonly engine: Engine;
  readonly events: EngineEvents;
  initialize(api: InitApi): void | Promise<void>;
  worldOpened(world: World): void;
  worldClosing(world: World): void;
  shutdown(): void;
}
```

| Member | Called |
| --- | --- |
| `initialize` | Once, before the start level opens. |
| `worldOpened` | After each world's game mode has begun play. |
| `worldClosing` | Before each world's actors end play. |
| `shutdown` | Once, from `engine.destroy`. |

A game supplies its own subclass through `GameDefinition.instance`. The class
takes no constructor arguments, and the engine constructs it with none. Omitting
the field uses `GameInstance` itself, which suits a game whose whole state fits
in its worlds.

`engine` is assigned before `initialize` runs, so a constructor sets defaults
and nothing more. Anything that reads the engine, loads an asset, or registers a
binding belongs in `initialize`. `events` is the same broadcaster that
`engine.events` reaches.

The base class's methods do nothing, so a subclass overrides only what it needs.
`initialize` may return a promise, and the engine awaits it before the start
level opens.

```ts
class Arcade extends GameInstance {
  best = 0;

  worldOpened(world: World): void {
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
[game state](/engines/structured-2d/apis/game-mode/) instead, which is rebuilt
with its world. Score, phase, elapsed match time, and per-player figures belong
there, so a transition clears them without the instance doing anything.

`worldOpened` and `worldClosing` are where the two meet. A game reads the
outgoing world's state into the instance from `worldClosing`, and seeds the
incoming world from `worldOpened`.

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

Everything declared here belongs to the whole game and survives every level
transition: the action bindings, the cue definitions, the assets the instance
holds, and the diagnostic sources the overlay reads.

```ts
class Arcade extends GameInstance {
  sheet!: ImageBitmap;

  async initialize(api: InitApi): Promise<void> {
    api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
    api.audio.define("score", { freq: 660, durationMs: 90 });
    this.sheet = await api.assets.loadImage("sprites/ship.png");
  }
}
```

An asset only one level needs is loaded in that level's `load` instead, which
the engine awaits before any actor of that level exists.

## Errors

| Condition | Result |
| --- | --- |
| `initialize` throws or rejects | `engine.initialize` rejects with the cause, and no frame runs |

A failure here reaches the caller that built the engine, so a build reports a
missing asset or a bad binding at the point it was asked for rather than as a
game that runs and draws nothing.

## Exports

`GameInstance` is exported as a class from `@test-cabinet/structured-2d`.
`GameDefinition`, `GameInstanceClass`, and `InitApi` are exported as types from
the same specifier.
