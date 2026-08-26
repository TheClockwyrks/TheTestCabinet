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
| `PlayerController.input` | The reader for the registered actions and the pointer. See `input.md`. |

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
given and returns the pawn to rest. Forward is the pawn's local −Z, so its
heading is its rotation and a turn is a rotation about the world's +Y.

```ts
import {
  MeshComponent,
  Pawn,
  quatFromAxisAngle,
  quatMultiply,
  rotateVec3,
  vec3Add,
  vec3Scale,
} from "@test-cabinet/structured-3d";
import { ARENA, ROVER } from "./constants";
import { meshes } from "./meshes";

export class Rover extends Pawn {
  private throttle = 0;
  private turn = 0;

  constructor() {
    super();
    this.attach(new MeshComponent({ mesh: meshes.rover }));
  }

  drive(throttle: number, turn: number): void {
    this.throttle = Math.max(-1, Math.min(1, throttle));
    this.turn = Math.max(-1, Math.min(1, turn));
  }

  override tick(dt: number): void {
    const spin = quatFromAxisAngle(
      { x: 0, y: 1, z: 0 },
      -this.turn * ROVER.turnRate * dt,
    );
    this.transform.rotation = quatMultiply(this.transform.rotation, spin);

    const forward = rotateVec3(this.transform.rotation, { x: 0, y: 0, z: -1 });
    this.transform.position = vec3Add(
      this.transform.position,
      vec3Scale(forward, this.throttle * ROVER.speed * dt),
    );

    const p = this.transform.position;
    p.x = Math.max(-ARENA.half, Math.min(ARENA.half, p.x));
    p.z = Math.max(-ARENA.half, Math.min(ARENA.half, p.z));

    this.throttle = 0;
    this.turn = 0;
  }
}
```

The pawn scales its movement by the frame's delta and clamps itself to the
arena, so every driver gets the same speed and the same limits.

## The player controller

Read the actions in `tick`. Controllers tick before any actor, so what the
controller writes here is what the pawn's own tick applies this frame. Take a
signed axis as the difference between two opposed actions so holding both
cancels out, and use `pressed` for anything that happens once per press.

```ts
import { PlayerController } from "@test-cabinet/structured-3d";
import { Ball } from "./ball";
import { Rover } from "./rover";

export class RoverController extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    pawn.drive(
      this.input.value("move-forward") - this.input.value("move-back"),
      this.input.value("move-right") - this.input.value("move-left"),
    );

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

The pointer stays 2D and logical. A controller that aims into the scene builds a
ray with `world.camera.ray(this.input.pointer())` and casts it with
`world.collision.raycast`; the composition is specified in `camera.md` and
`collision.md`.

## The AI controller

Subclass `AIController` and compute the same drive from the world. The reads are
the world's own object model, so the bot decides from what it can see rather
than from input.

```ts
import { AIController, rotateVec3, vec3Dot, vec3Sub } from "@test-cabinet/structured-3d";
import { AI_DEADZONE } from "./constants";
import { Beacon } from "./beacon";
import { Rover } from "./rover";

export class RoverBot extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    const beacon = this.world.find(Beacon);
    if (!beacon) {
      pawn.drive(0, 0);
      return;
    }

    const to = vec3Sub(beacon.transform.position, pawn.transform.position);
    const right = rotateVec3(pawn.transform.rotation, { x: 1, y: 0, z: 0 });
    const side = vec3Dot(to, right);

    pawn.drive(1, Math.abs(side) < AI_DEADZONE ? 0 : Math.sign(side));
  }
}
```

The bot steers by which side of its heading the beacon sits on: the dot of the
offset with the pawn's local +X is positive when the target is to the right.
Both controllers finish with the same call to `drive`. What precedes it differs,
and the pawn sees one interface — so choosing between them is a line in the
mode's `beginPlay`:

```ts
override beginPlay(): void {
  this.addPlayer({ name: "Player 1" });

  if (this.options.twoPlayer === true) {
    this.addPlayer({ name: "Player 2" });
  } else {
    this.addBot(RoverBot, { name: "Opponent" });
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

A validator reaches the pawn the same way a match does: it constructs a
controller of its own, possesses the pawn with it, and steps the engine, and the
pawn moves exactly as it does under a player.

## Errors

| Condition | Result |
| --- | --- |
| A controller's `beginPlay` throws while the start level is being built | `engine.initialize` rejects with the cause |
| A controller's `tick` throws under `engine.run` | The error propagates to the host, and the loop schedules the next frame |
| A controller's `tick` throws under `engine.advance` | `advance` rejects with the cause, and the remaining frames do not run |
