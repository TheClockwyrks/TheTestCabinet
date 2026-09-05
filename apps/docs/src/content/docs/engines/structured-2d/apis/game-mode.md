---
title: Game Mode
---

A game mode is the rules of a match. A level names its class, and opening the
level constructs the mode with the options the transition supplied, builds the
game state from the mode's `gameStateClass`, and runs its `beginPlay` after
every declared actor has begun play. The mode is the only object that adds
players and bots, restarts their pawns, moves the match through its phases, and
decides when the match is over.

## `GameModeClass`

```ts
type GameModeClass = new () => GameMode;
```

A mode is constructed with no arguments, so a constructor sets the mode's class
fields and its own defaults. `world`, `options`, and `state` are assigned before
`beginPlay` runs.

## `MatchPhase`

```ts
type MatchPhase = "waiting" | "playing" | "over";
```

| Phase | Meaning |
| --- | --- |
| `waiting` | The match is being set up. This is the phase a mode holds when it begins play. |
| `playing` | The match is running. `GameState.elapsed` accumulates only in this phase. |
| `over` | The match is decided. |

The phase changes only through `setPhase`.

## `EndPlayReason`

```ts
type EndPlayReason = "destroyed" | "level-closed";
```

| Reason | Given to |
| --- | --- |
| `destroyed` | An actor and its components ending play because the actor was destroyed, and a component removed by `detach`. |
| `level-closed` | Every controller, actor, component, and game mode ending play because the world is closing. |

## `GameMode`

```ts
class GameMode {
  readonly world: World;
  readonly options: Readonly<Record<string, unknown>>;
  readonly state: GameState;
  readonly phase: MatchPhase;

  gameStateClass: new () => GameState;
  playerStateClass: new () => PlayerState;
  playerControllerClass: ControllerClass<PlayerController>;
  pawnClass: ActorClass<Pawn> | null;

  beginPlay(): void;
  tick(dt: number): void;
  endPlay(reason: EndPlayReason): void;

  addPlayer(options?: PlayerOptions): PlayerController;
  addBot(type: ControllerClass<AIController>, options?: BotOptions): AIController;
  restart(controller: Controller): Pawn | null;
  spawnPoint(controller: Controller): Transform;
  pawnDied(controller: Controller, pawn: Pawn): void;
  setPhase(phase: MatchPhase): void;
}
```

| Member | Semantics |
| --- | --- |
| `world` | The world this mode governs. |
| `options` | Whatever `world.open` was given, or an empty object for the start level. |
| `state` | The world's game state, the instance built from `gameStateClass`. |
| `phase` | The match phase. `"waiting"` when the mode begins play. |
| `gameStateClass` | Defaults to `GameState`. Read once, when the world is built. |
| `playerStateClass` | Defaults to `PlayerState`. Read on each `addPlayer` and `addBot`. |
| `playerControllerClass` | The controller `addPlayer` builds when its options name none. |
| `pawnClass` | The pawn `restart` spawns. `null` for a mode whose controllers possess nothing. |
| `beginPlay` | Runs after every declared actor has begun play. Where a mode adds its players and sets its phase. |
| `tick` | Runs once per frame, after every actor has ticked and after collision has been reported, so the mode decides the match from a settled world. |
| `endPlay` | Runs when the world closes, after every actor has ended play. |
| `addPlayer` | Builds the player state, the player controller, and the pawn, and possesses. Assigns the next free index when the options name none. |
| `addBot` | The same for an AI controller. A bot's player state carries the next free index. |
| `restart` | Destroys the controller's current pawn, spawns `pawnClass` at `spawnPoint(controller)`, and possesses it. Returns `null` when `pawnClass` is `null`. |
| `spawnPoint` | Where `restart` places a pawn. The base implementation returns the center of the design field. |
| `pawnDied` | Runs when a possessed pawn is destroyed, after the pawn's `endPlay`. The base implementation does nothing. |
| `setPhase` | Sets the phase, writes it onto the game state, and emits `match:phase`. Setting the phase it already holds emits nothing. |

The base class's `beginPlay`, `tick`, `endPlay`, and `pawnDied` do nothing, so a
mode overrides only what it needs.

## `PlayerOptions`

```ts
interface PlayerOptions {
  index?: number;
  name?: string;
  controller?: ControllerClass<PlayerController>;
  pawn?: ActorClass<Pawn> | null;
}
```

| Field | Meaning |
| --- | --- |
| `index` | The index the player state carries. Absent, `addPlayer` assigns the next free index. |
| `name` | The name written onto the player state. |
| `controller` | The controller class to build. Absent, `addPlayer` builds `playerControllerClass`. |
| `pawn` | The pawn class to spawn and possess, in place of `pawnClass`. `null` adds a controller that possesses nothing. |

## `BotOptions`

```ts
interface BotOptions {
  name?: string;
  pawn?: ActorClass<Pawn> | null;
}
```

| Field | Meaning |
| --- | --- |
| `name` | The name written onto the bot's player state. |
| `pawn` | The pawn class to spawn and possess, in place of `pawnClass`. `null` adds a controller that possesses nothing. |

`addBot` takes the controller class as its first argument, so `BotOptions` names
no controller. A bot's player state carries the next free index and sits in
`state.players` alongside a player's.

## `GameState`

```ts
class GameState {
  readonly world: World;
  readonly players: readonly PlayerState[];
  phase: MatchPhase;
  elapsed: number;
}
```

| Member | Semantics |
| --- | --- |
| `world` | The world this state belongs to. |
| `players` | Every player state, in index order, a bot's alongside a player's. |
| `phase` | The phase `setPhase` last wrote. |
| `elapsed` | Seconds accumulated while the phase is `"playing"`. |

`elapsed` is the match clock rather than the world clock. A game carries its own
match figures by subclassing `GameState` and naming that subclass in
`gameStateClass`.

## `PlayerState`

```ts
class PlayerState {
  readonly index: number;
  readonly controller: Controller;
  name: string;
  score: number;
}
```

| Member | Semantics |
| --- | --- |
| `index` | The participant's index, assigned when the player or bot is added. |
| `controller` | The controller this state belongs to. |
| `name` | The participant's display name. |
| `score` | The participant's score. |

A game carries its own per-player figures by subclassing `PlayerState` and
naming that subclass in `playerStateClass`. The state is the durable half of a
participant: it survives every respawn its controller performs.

## Errors

| Condition | Result |
| --- | --- |
| `beginPlay` throws while the start level is opening | `engine.initialize` rejects with the cause |
| `tick` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| `tick` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |

A throw under `run` leaves the loop alive, so one bad frame leaves the game
running. A throw under `advance` stops at once, because a caller stepping an
exact number of frames needs the failure rather than the frames after it.

## Exports

`GameMode`, `GameState`, and `PlayerState` are exported as classes from
`@clockwyrks/structured-2d`. `GameModeClass`, `MatchPhase`, `EndPlayReason`,
`PlayerOptions`, and `BotOptions` are exported as types.
