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

| Member | Semantics |
| --- | --- |
| `world` | The world that holds the controller. |
| `pawn` | The pawn the controller holds, or `null`. |
| `playerState` | The player state built alongside the controller, carrying its index, name, and score. |
| `possess(pawn)` | Takes `pawn`. See Possession below. |
| `unpossess()` | Releases the held pawn. See Possession below. |
| `beginPlay()` | Runs once, as the controller is added to the world. |
| `tick(dt)` | Runs once per frame, before any actor ticks. `dt` is seconds. |
| `endPlay(reason)` | Runs with `"level-closed"` when the world closes, in reverse order of addition. |
| `PlayerController.index` | The player index the controller was added under, which is the value its player state carries. |
| `PlayerController.input` | The reader for the registered actions, the pointer, and the wheel. See `input.md`. |

The base class's methods do nothing, so a subclass overrides only what it needs.
A subclass reads its input or runs its behavior in `tick` and writes to
`this.pawn`.

Controllers are built by the game mode: `addPlayer` builds the player state, the
player controller, and the pawn, and possesses; `addBot` does the same for an AI
controller whose class the caller names. A controller carries its pawn and its
player state alone, so the world's actor list stays a list of things in the
world; `world.controllers()` reports every controller in the order they were
added, and `world.players()` the player controllers alone, in index order.

## The pawn's half

Subclass `Pawn` and expose the movement the pawn can perform. `drive` here is
the whole interface a controller uses, and `tick` applies the intent it was
given and returns the pawn to rest:

```ts
import {
  FORWARD,
  MeshComponent,
  Pawn,
  RIGHT,
  add,
  quatFromEuler,
  quatRotate,
  scale,
  vec3,
} from "@test-cabinet/structured-3d";
import type { Vec2 } from "@test-cabinet/structured-3d";
import { FIELD, SHIP } from "./constants";

export class Ship extends Pawn {
  yaw = 0;
  private move: Vec2 = { x: 0, y: 0 };

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "capsule", radius: 0.4, height: 1 },
        material: { color: "#d9d9d9" },
      }),
    );
  }

  /** The move intent, each component clamped to `-1..1`. */
  drive(x: number, z: number): void {
    this.move = {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, z)),
    };
  }

  /** The look intent, in radians per second. */
  turn(rate: number): void {
    this.yaw += rate;
  }

  override tick(dt: number): void {
    this.transform.rotation = quatFromEuler(0, this.yaw, 0);

    const forward = quatRotate(this.transform.rotation, FORWARD);
    const right = quatRotate(this.transform.rotation, RIGHT);
    const step = add(
      scale(forward, this.move.y * SHIP.speed * dt),
      scale(right, this.move.x * SHIP.speed * dt),
    );

    const at = add(this.transform.position, step);
    this.transform.position = vec3(
      Math.max(-FIELD.halfWidth, Math.min(FIELD.halfWidth, at.x)),
      at.y,
      Math.max(-FIELD.halfDepth, Math.min(FIELD.halfDepth, at.z)),
    );

    this.move = { x: 0, y: 0 };
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
import { PlayerController } from "@test-cabinet/structured-3d";
import { Ship } from "./ship";
import { LOOK_RATE } from "./constants";

export class ShipController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Ship)) return;

    pawn.drive(
      this.input.value("move-right") - this.input.value("move-left"),
      this.input.value("move-up") - this.input.value("move-down"),
    );

    pawn.turn(
      (this.input.value("look-right") - this.input.value("look-left")) *
        LOOK_RATE *
        dt,
    );

    if (this.input.pressed("a")) pawn.fire();
  }
}
```

A controller keeps ticking after its pawn is destroyed, holding `null` until the
mode restarts it, so a controller's tick starts by confirming it holds the pawn
it drives.

`PlayerController.input` is the only place a game reads an action. The engine
owns the keyboard and the pointer, resolves each registered action to one
number, and the reader reports that number by name — so the objects in a world
reach input through the controller that possesses them and through nothing else.
Each player controller consumes edges independently: an edge armed on an action
is `pressed` exactly once per controller that asks, the first read within one
controller consumes that controller's copy, and the input frame closes after the
frame renders, discarding every edge left unconsumed. Read a given action's edge
in one place per controller.

## Picking with the pointer

The pointer arrives in logical coordinates. A controller that needs to know what
the pointer is over turns the position into a world-space ray through the
camera and casts it against the collision world:

```ts
import { PlayerController } from "@test-cabinet/structured-3d";
import { CHANNELS, PICK_RANGE, TAGS } from "./constants";

export class CursorController extends PlayerController {
  override tick(): void {
    if (!this.input.pointerPressed()) return;

    const ray = this.world.camera.logicalToRay(this.input.pointer());
    const hit = this.world.collision.raycast(
      ray.origin,
      ray.direction,
      PICK_RANGE,
      { channel: CHANNELS.cursor, responses: { [CHANNELS.target]: "overlap" } },
    );

    if (hit !== null) hit.actor.addTag(TAGS.selected);
  }
}
```

See `camera.md` for `logicalToRay` and `collision.md` for the raycasts.

## The AI controller

Subclass `AIController` and compute the same drive from the world. The reads are
the world's own object model, so the bot decides from what it can see rather
than from input.

```ts
import { AIController, distance, sub } from "@test-cabinet/structured-3d";
import { Ball } from "./ball";
import { Ship } from "./ship";
import { AI_DEADZONE } from "./constants";

export class ShipBot extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Ship)) return;

    const ball = this.world.find(Ball);
    if (ball === null) {
      pawn.drive(0, 0);
      return;
    }

    const to = sub(ball.transform.position, pawn.transform.position);
    if (distance(ball.transform.position, pawn.transform.position) < AI_DEADZONE) {
      pawn.drive(0, 0);
      return;
    }

    pawn.drive(Math.sign(to.x), Math.sign(-to.z));
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
    this.addBot(ShipBot, { name: "Opponent" });
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

| Field | Meaning |
| --- | --- |
| `controller` | The controller whose possession changed. |
| `pawn` | What the controller holds after the change, and `null` for an unpossession. |
| `previous` | What the controller held before the change, and `null` when it held nothing. |

`GameMode.restart(controller)` destroys the controller's current pawn, spawns
`pawnClass` at `spawnPoint(controller)`, and possesses it, returning `null` when
`pawnClass` is `null`. A destroyed pawn is unpossessed first, and the mode's
`pawnDied(controller, pawn)` runs afterwards, once the pawn's `endPlay` has run.
See `game-modes.md`.

Possession ends with the world. Each controller's `endPlay("level-closed")` runs
in reverse order of addition, before the actors end play, and the incoming level
builds fresh controllers, player states, and pawns.

## Errors

| Condition | Result |
| --- | --- |
| A controller's `beginPlay` throws while the start level is being built | `engine.initialize` rejects with the cause |
| A controller's `tick` throws under `engine.run` | The error propagates to the host, and the loop schedules the next frame |
| A controller's `tick` throws under `engine.advance` | `advance` rejects with the cause, and the remaining frames do not run |
