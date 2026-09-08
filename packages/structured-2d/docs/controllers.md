# Controllers and possession

A controller is the seat a pawn is driven from. The game mode builds one
controller per player and one per bot, each controller possesses a pawn, and the
controller's tick writes that pawn's intent for the frame. A player controller
reads the registered actions, and an AI controller computes the same drive from
the world — so the same pawn class serves both, and anything that can construct
a controller can drive a pawn along the path play uses.

## The classes

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
```

| Member                   | Semantics                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `world`                  | The world that holds the controller.                                                          |
| `pawn`                   | The pawn the controller holds, or `null`.                                                     |
| `playerState`            | The player state built alongside the controller, carrying its index, name, and score.         |
| `possess(pawn)`          | Takes `pawn`. See Possession below.                                                           |
| `unpossess()`            | Releases the held pawn. See Possession below.                                                 |
| `beginPlay()`            | Runs once, as the controller is added to the world.                                           |
| `tick(dt)`               | Runs once per frame, before any actor ticks. `dt` is seconds.                                 |
| `endPlay(reason)`        | Runs with `"level-closed"` when the world closes, in reverse order of addition.               |
| `PlayerController.index` | The player index the controller was added under, which is the value its player state carries. |
| `PlayerController.input` | The reader for the registered actions and the pointer. See `input.md`.                        |

The base class's methods do nothing, so a subclass overrides only what it needs.
A subclass reads its input or runs its behavior in `tick` and writes to
`this.pawn`.

Controllers are built by the game mode: `addPlayer` builds the player state,
the player controller, and the pawn, and possesses; `addBot` does the same for
an AI controller whose class the caller names. A controller carries its pawn and
its player state alone, so the world's actor list stays a list of things in the
world; `world.controllers()` reports every controller in the order they were
added, and `world.players()` the player controllers alone, in index order.

## The pawn's half

Subclass `Pawn` and expose the movement the pawn can perform. `drive` here is
the whole interface a controller uses, and `tick` applies the intent it was
given and returns the pawn to rest:

```ts
import { Pawn, ShapeComponent } from "@clockwyrks/structured-2d";
import { FIELD, PADDLE } from "./constants";

export class Paddle extends Pawn {
  private intent = 0;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: 16, height: PADDLE.halfHeight * 2 },
        fill: "#f2f2f2",
      }),
    );
  }

  drive(amount: number): void {
    this.intent = Math.max(-1, Math.min(1, amount));
  }

  override tick(dt: number): void {
    const y = this.transform.y + this.intent * PADDLE.speed * dt;
    const top = PADDLE.halfHeight;
    const bottom = FIELD.height - PADDLE.halfHeight;
    this.transform.y = Math.max(top, Math.min(bottom, y));
    this.intent = 0;
  }
}
```

The pawn scales its movement by the frame's delta and clamps itself to the
field, so every driver gets the same speed and the same limits.

## The player controller

Read the actions in `tick`. Controllers tick before any actor, so what the
controller writes here is what the pawn's own tick applies this frame. Take a
signed axis as the difference between two directions so holding both cancels
out, and use `pressed` for anything that happens once per press.

```ts
import { PlayerController } from "@clockwyrks/structured-2d";
import { Ball } from "./ball";
import { Paddle } from "./paddle";

export class PaddleController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    pawn.drive(this.input.value("down") - this.input.value("up"));

    if (this.input.pressed("confirm")) {
      this.world.find(Ball)?.launch();
    }
  }
}
```

A controller keeps ticking after its pawn is destroyed, holding `null` until the
mode restarts it, so a controller's tick starts by confirming it holds the pawn
it drives.

`PlayerController.input` is the only place a game reads an action. The engine
owns the keyboard, resolves each registered action to one number, and the reader
reports that number by name — so the objects in a world reach the keyboard
through the controller that possesses them and through nothing else. Each player
controller consumes edges independently: an edge armed on an action is `pressed`
exactly once per controller that asks, the first read within one controller
consumes that controller's copy, and the input frame closes after the frame
renders, discarding every edge left unconsumed. Read a given action's edge in
one place per controller.

## The AI controller

Subclass `AIController` and compute the same drive from the world. The reads are
the world's own object model, so the bot decides from what it can see rather
than from input.

```ts
import { AIController } from "@clockwyrks/structured-2d";
import { AI_DEADZONE } from "./constants";
import { Ball } from "./ball";
import { Paddle } from "./paddle";

export class AIPaddleController extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    const ball = this.world.find(Ball);
    if (!ball) {
      pawn.drive(0);
      return;
    }

    const delta = ball.transform.y - pawn.transform.y;
    pawn.drive(Math.abs(delta) < AI_DEADZONE ? 0 : Math.sign(delta));
  }
}
```

Both controllers finish with the same call to `drive`. What precedes it differs,
and the pawn sees one interface. Choosing between them is a line in the mode's
`beginPlay`:

```ts
override beginPlay(): void {
  this.addPlayer({ name: "Player 1" });

  if (this.options.twoPlayer === true) {
    this.addPlayer({ name: "Player 2" });
  } else {
    this.addBot(AIPaddleController, { name: "Opponent" });
  }

  this.setPhase("playing");
}
```

## Possession

`possess(pawn)` unpossesses whatever the controller held, sets `pawn`, notifies
the pawn through its `possessedBy`, and emits `possession:changed`. Possessing a
pawn another controller already holds unpossesses that controller first, so one
controller holds one pawn and one pawn answers to one controller.

`unpossess()` clears `pawn`, notifies the released pawn through its
`unpossessed`, and emits `possession:changed`. The released pawn stays in the
world, alive and ticking, with its own `controller` back to `null`; its intent
is whatever it was left holding until another controller takes it.

```ts
"possession:changed": {
  controller: Controller;
  pawn: Pawn | null;
  previous: Pawn | null;
};
```

| Field        | Meaning                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `controller` | The controller whose possession changed.                                     |
| `pawn`       | What the controller holds after the change, and `null` for an unpossession.  |
| `previous`   | What the controller held before the change, and `null` when it held nothing. |

`GameMode.restart(controller)` destroys the controller's current pawn, spawns
`pawnClass` at `spawnPoint(controller)`, and possesses it, returning `null` when
`pawnClass` is `null`. A destroyed pawn is unpossessed first, and the mode's
`pawnDied(controller, pawn)` runs afterwards, once the pawn's `endPlay` has run.
See `game-modes.md`.

Possession ends with the world. Each controller's `endPlay("level-closed")` runs
in reverse order of addition, before the actors end play, and the incoming level
builds fresh controllers, player states, and pawns.

## Errors

| Condition                                                              | Result                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A controller's `beginPlay` throws while the start level is being built | `engine.initialize` rejects with the cause                              |
| A controller's `tick` throws under `engine.run`                        | The error propagates to the host, and the loop schedules the next frame |
| A controller's `tick` throws under `engine.advance`                    | `advance` rejects with the cause, and the remaining frames do not run   |
