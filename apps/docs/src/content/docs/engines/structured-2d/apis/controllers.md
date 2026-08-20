---
title: Controllers
---

A controller is the seat a pawn is driven from. The game mode builds one
controller per player and one per bot, each controller possesses a pawn, and the
controller's tick writes that pawn's intent for the frame. A player controller
reads the registered actions, and an AI controller computes the same drive from
the world.

## Types

```ts
type ControllerClass<C extends Controller = Controller> = new () => C;

class Controller {
  readonly world: World;
  readonly pawn: Pawn | null;
  readonly playerState: PlayerState;

  possess(pawn: Pawn): void;
  unpossess(): void;

  beginPlay(): void;
  tick(dt: number): void;
  endPlay(reason: EndPlayReason): void;
}

class PlayerController extends Controller {
  readonly index: number;
  readonly input: InputReader;
}

class AIController extends Controller {}

interface InputReader {
  value(name: string): number;
  pressed(name: string): boolean;
}
```

| Member | Semantics |
| --- | --- |
| `world` | The world that holds the controller. |
| `pawn` | The pawn the controller holds, or `null`. |
| `playerState` | The player state built alongside the controller, carrying its index, name, and score. |
| `possess(pawn)` | Takes `pawn`, as specified under Possession below. |
| `unpossess()` | Releases the held pawn, as specified under Possession below. |
| `beginPlay()` | Runs once, as the controller is added to the world. |
| `tick(dt)` | Runs once per frame, before any actor ticks. `dt` is seconds. |
| `endPlay(reason)` | Runs with `"level-closed"` when the world closes, in reverse order of addition. |
| `PlayerController.index` | The player index the controller was added under, which is the value its player state carries. |
| `PlayerController.input` | The reader for the registered actions. |
| `InputReader.value(name)` | The action's magnitude: `0` or `1` for a digital action, the magnitude as given for an analog one, and `0` for an unregistered name. |
| `InputReader.pressed(name)` | `true` exactly once per armed edge per player controller, and the call consumes this controller's copy. |

The base class's methods do nothing, so a subclass overrides only what it needs.
A subclass reads its input or runs its behavior in `tick` and writes to
`this.pawn`.

## Controllers in the world

A controller carries its pawn and its player state alone, so the world's actor
list stays a list of things in the world. Controllers keep their own list:
`world.controllers()` reports every controller, player and AI alike, in the
order they were added, and `world.players()` reports the player controllers
alone, in index order.

Controllers are built by the
[game mode](/engines/structured-2d/apis/game-mode/). `addPlayer` builds the
player state, the player controller, and the pawn, and possesses. `addBot` does
the same for an AI controller whose class the caller names.
`playerControllerClass` is the class `addPlayer` builds when its options name
none, and `pawnClass` is the pawn class both of them spawn.

## Possession

`possess(pawn)` unpossesses whatever the controller held, sets `pawn`, notifies
the pawn through its `possessedBy`, and emits `possession:changed`. Possessing a
pawn another controller already holds unpossesses that controller first, so one
controller holds one pawn and one pawn answers to one controller.

`unpossess()` clears `pawn`, notifies the released pawn through its
`unpossessed`, and emits `possession:changed`. The released pawn stays in the
world, alive and ticking, with its own `controller` back to `null`. Its intent
is whatever it was left holding until another controller takes it.

```ts
"possession:changed": {
  controller: Controller;
  pawn: Pawn | null;
  previous: Pawn | null;
};
```

| Field | Meaning |
| --- | --- |
| `controller` | The controller whose possession changed. |
| `pawn` | What the controller holds after the change, and `null` for an unpossession. |
| `previous` | What the controller held before the change, and `null` when it held nothing. |

`GameMode.restart(controller)` destroys the controller's current pawn, spawns
`pawnClass` at `spawnPoint(controller)`, and possesses it, returning `null` when
`pawnClass` is `null`. A destroyed pawn is unpossessed first, and the mode's
`pawnDied(controller, pawn)` runs afterwards, once the pawn's `endPlay` has run.

## Ticking

Each controller ticks once per frame, in the order they were added, and every
controller ticks before the first actor does. A pawn's own tick therefore
observes the intent its controller wrote this frame, and a pawn reads that
intent as a plain field rather than as input.

A paused world runs no controller tick. When a world closes, each controller's
`endPlay("level-closed")` runs in reverse order, before the actors end play.

## Reading input

`PlayerController.input` is the only place a game reads an action. The engine
owns the keyboard, resolves each registered action to one number, and the reader
reports that number by name. A player pawn and an AI pawn are therefore the same
class driven by two different controllers, and a validator drives a pawn by
substituting a controller of its own. The
[possession](/engines/structured-2d/concepts/possession/) concept page covers
what that buys.

Each player controller consumes edges independently. An edge armed on an action
is `pressed` exactly once for each controller that asks, so two controllers
bound to one action each see the press, and within one controller the first read
takes it. The engine closes the input frame after the frame renders, discarding
every edge left unconsumed, so a press is news for exactly one frame.

The action registry itself belongs to the whole game and is declared once, from
[`InitApi.input`](/engines/structured-2d/apis/input/).

## Errors

| Condition | Result |
| --- | --- |
| A controller's `beginPlay` throws while the start level is being built | `engine.initialize` rejects with the cause |
| A controller's `tick` throws under `engine.run` | The error propagates to the host, and the loop schedules the next frame |
| A controller's `tick` throws under `engine.advance` | `advance` rejects with the cause, and the remaining frames do not run |

## Exports

`Controller`, `PlayerController`, and `AIController` are exported as classes
from `@test-cabinet/structured-2d`, and `ControllerClass` and `InputReader` are
exported as types.
