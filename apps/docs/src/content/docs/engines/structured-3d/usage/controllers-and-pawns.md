---
title: Controllers and Pawns
---

A pawn is a thing in the world that can be driven. A controller decides what it
does each frame. Writing the two apart is what lets one pawn class serve a
player and a computer opponent, and it is what lets a check drive a pawn by
possessing it. The [controller
surface](/engines/structured-3d/apis/controllers/) specifies both halves.

## Registering the vocabulary

Select the touch layout the case asks for when the engine is created. The
selection holds for the engine's lifetime, so every registration is attributed
against the same vocabulary.

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { game } from "./game";
import { FIELD } from "./constants";

const engine = createEngine({
  canvas,
  width: FIELD.width,
  height: FIELD.height,
  game,
  layout: "dual-stick",
});
```

Register one action per name from the game instance's `initialize`, which the
engine runs to completion before the start level opens. A key table indexed by
action name registers the layout's whole vocabulary in one pass, and the
bindings survive every level transition. A stick's directional actions are
registered `"analog"`, so a deflection reaches the controller as a magnitude in
`0..1` rather than as `0` or `1`.

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-3d";
import { KEYS, STICK_ACTIONS } from "./constants";

export class Rally extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const action of api.input.layout()?.actions ?? []) {
      api.input.register(action, {
        keys: KEYS[action] ?? [],
        kind: STICK_ACTIONS.has(action) ? "analog" : "digital",
      });
    }
    return null;
  }
}
```

`KEYS` lives beside the rest of the case's fixed values, so one module holds
every name the game and its validators agree on. A held key gives a stick action
full deflection, so the keyboard drives the same actions the sticks do.

```ts
export const FIELD = { width: 1280, height: 720 };
export const ARENA = { halfWidth: 12, halfDepth: 8 };
export const ROVER = { speed: 6, turnRate: 2.5, pitchLimit: Math.PI / 4 };
export const AI_DEADZONE = 0.25;

export const STICK_ACTIONS: ReadonlySet<string> = new Set([
  "move-up", "move-down", "move-left", "move-right",
  "look-up", "look-down", "look-left", "look-right",
]);

export const KEYS: Record<string, string[]> = {
  "move-up": ["KeyW"],
  "move-down": ["KeyS"],
  "move-left": ["KeyA"],
  "move-right": ["KeyD"],
  "look-up": ["ArrowUp"],
  "look-down": ["ArrowDown"],
  "look-left": ["ArrowLeft"],
  "look-right": ["ArrowRight"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};
```

## The pawn

Subclass `Pawn` and expose the movement the pawn can perform. The constructor
attaches components and sets defaults. `drive` is the whole interface a
controller uses: a move intent and a look intent, each a `Vec2` in `-1..1`.
`tick` applies both and returns the pawn to rest.

```ts
import {
  CameraComponent,
  FORWARD,
  MeshComponent,
  Pawn,
  RIGHT,
  UP,
  add,
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
  scale,
  vec3,
  type Vec2,
} from "@test-cabinet/structured-3d";
import { ARENA, ROVER } from "./constants";

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

export class Rover extends Pawn {
  readonly eye: CameraComponent;
  private move: Vec2 = { x: 0, y: 0 };
  private look: Vec2 = { x: 0, y: 0 };
  private pitch = 0;

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "capsule", radius: 0.4, height: 0.8 },
        material: { color: "#f2f2f2" },
      }),
    );
    this.eye = this.attach(new CameraComponent({ fov: 70 }));
    this.eye.offset.position = vec3(0, 0.8, 0);
  }

  drive(move: Vec2, look: Vec2): void {
    this.move = { x: clamp1(move.x), y: clamp1(move.y) };
    this.look = { x: clamp1(look.x), y: clamp1(look.y) };
  }

  tick(dt: number): void {
    const yaw = quatFromAxisAngle(UP, -this.look.x * ROVER.turnRate * dt);
    this.transform.rotation = quatMultiply(yaw, this.transform.rotation);

    this.pitch += this.look.y * ROVER.turnRate * dt;
    this.pitch = Math.max(-ROVER.pitchLimit, Math.min(ROVER.pitchLimit, this.pitch));
    this.eye.offset.rotation = quatFromAxisAngle(RIGHT, this.pitch);

    const forward = quatRotate(this.transform.rotation, FORWARD);
    const right = quatRotate(this.transform.rotation, RIGHT);
    const step = add(scale(forward, this.move.y), scale(right, this.move.x));
    const next = add(this.transform.position, scale(step, ROVER.speed * dt));
    this.transform.position = vec3(
      Math.max(-ARENA.halfWidth, Math.min(ARENA.halfWidth, next.x)),
      next.y,
      Math.max(-ARENA.halfDepth, Math.min(ARENA.halfDepth, next.z)),
    );

    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
  }
}
```

The pawn scales its movement by the frame's delta and clamps itself to the
arena, so every driver gets the same speed and the same limits. The move intent
is read in the pawn's own axes, `FORWARD` and `RIGHT` rotated by its rotation,
so pushing the stick forward always moves the rover the way it faces. The look
intent turns the rover about the world's up axis and pitches the camera
component mounted on it, and the world's camera adopts that component's world
transform and `fov` while it follows the rover.

## The player controller

Subclass `PlayerController` and read the actions in `tick`. Controllers tick
before any actor, so what the controller writes here is what the pawn's own tick
applies this frame. Take a signed axis as the difference between two directions
so holding both cancels out, and use `pressed` for anything that happens once
per press.

```ts
import { PlayerController } from "@test-cabinet/structured-3d";
import { Ball } from "./ball";
import { Rover } from "./rover";

export class RoverController extends PlayerController {
  tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    const input = this.input;
    pawn.drive(
      {
        x: input.value("move-right") - input.value("move-left"),
        y: input.value("move-up") - input.value("move-down"),
      },
      {
        x: input.value("look-right") - input.value("look-left"),
        y: input.value("look-up") - input.value("look-down"),
      },
    );

    if (input.pressed("confirm")) {
      this.world.find(Ball)?.launch();
    }
  }
}
```

Each stick arrives as four analog actions, so the left stick's deflection is
recovered as two signed axes from the `move-` actions and the right stick's from
the `look-` actions. A stick pushed half-way reports about `0.5` on the action
it leans toward, and the difference carries that magnitude through to the pawn.

A controller keeps ticking after its pawn is destroyed, holding `null` until the
mode restarts it, so a controller's tick starts by confirming it holds the pawn
it drives.

Read a given action's edge in one place per controller. The first read consumes
this controller's copy, so a second read in the same tick sees nothing, while a
second controller bound to the same action still sees the press.

## The AI controller

Subclass `AIController` and compute the same drive from the world. The reads are
the world's own object model, so the bot decides from what it can see rather
than from input.

```ts
import {
  AIController,
  normalize,
  quatInverse,
  quatRotate,
  sub,
} from "@test-cabinet/structured-3d";
import { AI_DEADZONE } from "./constants";
import { Ball } from "./ball";
import { Rover } from "./rover";

export class AIRoverController extends AIController {
  tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    const ball = this.world.find(Ball);
    if (!ball) {
      pawn.drive({ x: 0, y: 0 }, { x: 0, y: 0 });
      return;
    }

    const toBall = sub(ball.transform.position, pawn.transform.position);
    const local = normalize(quatRotate(quatInverse(pawn.transform.rotation), toBall));
    const turn = Math.abs(local.x) < AI_DEADZONE ? 0 : Math.sign(local.x);
    pawn.drive({ x: 0, y: -local.z }, { x: turn, y: 0 });
  }
}
```

`quatInverse` undoes the rover's rotation, so the offset to the ball is read in
the rover's own axes: `local.z` is negative when the ball lies ahead, and
`local.x` is the side it lies on. Both controllers finish with the same call to
`drive`. What precedes it differs, and the pawn sees one interface.

## Naming both on the game mode

The mode declares which classes it builds. `playerControllerClass` is what
`addPlayer` constructs, `pawnClass` is what both kinds of controller possess,
and `addBot` takes its controller class at the call. `spawnPoint` decides where
`restart` places a pawn, and `pawnDied` decides what a death means.

```ts
import {
  GameMode,
  UP,
  VEC3_ONE,
  quatFromAxisAngle,
  vec3,
  type Controller,
  type Transform,
} from "@test-cabinet/structured-3d";
import { AIRoverController } from "./ai-controller";
import { RoverController } from "./player-controller";
import { Rover } from "./rover";
import { ARENA } from "./constants";

export class RallyMode extends GameMode {
  playerControllerClass = RoverController;
  pawnClass = Rover;

  beginPlay(): void {
    const player = this.addPlayer({ name: "Player" });
    this.addBot(AIRoverController, { name: "Opponent" });
    this.world.camera.follow(player.pawn);
    this.setPhase("playing");
  }

  spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    return {
      position: vec3(left ? -ARENA.halfWidth + 2 : ARENA.halfWidth - 2, 0, 0),
      rotation: quatFromAxisAngle(UP, left ? -Math.PI / 2 : Math.PI / 2),
      scale: VEC3_ONE,
    };
  }

  pawnDied(controller: Controller): void {
    this.world.after(1, () => this.restart(controller));
  }
}
```

`addPlayer` and `addBot` each build a player state, a controller, and a pawn,
and possess. The player takes index `0` and the bot the next free index, which
is what puts one rover on each side, and the spawn rotation turns each to face
the other. `camera.follow` gives the world's camera the player's pawn as its
target, so the view rides the `CameraComponent` the rover carries.

## Swapping the driver

Because the two controllers write the same pawn, choosing between them is a line
in `beginPlay`. The mode's `options` carry whatever `world.open` was given, so
the same level serves one player against a bot and two players against each
other.

```ts
beginPlay(): void {
  const player = this.addPlayer({ name: "Player 1" });

  if (this.options.twoPlayer === true) {
    this.addPlayer({ name: "Player 2" });
  } else {
    this.addBot(AIRoverController, { name: "Opponent" });
  }

  this.world.camera.follow(player.pawn);
  this.setPhase("playing");
}
```

A validator reaches the pawn the same way: it constructs a controller of its
own, possesses the pawn with it, and steps the engine, and the pawn moves
exactly as it does under a player.
