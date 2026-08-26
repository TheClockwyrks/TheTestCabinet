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
import { HEIGHT, WIDTH } from "./constants";

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  layout: "stick-move",
});
```

Register one action per name from the game instance's `initialize`, which the
engine runs to completion before the start level opens. A key table indexed by
action name registers the layout's whole vocabulary in one pass, and the
bindings survive every level transition. The stick's actions are the ones to
register `"analog"`, so a stick's deflection reads as a magnitude while a held
key still gives full deflection.

```ts
import { GameInstance, type InitApi } from "@test-cabinet/structured-3d";
import { ANALOG, KEYS } from "./constants";

export class Rally extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const action of api.input.layout()?.actions ?? []) {
      api.input.register(action, {
        keys: KEYS[action] ?? [],
        kind: ANALOG.has(action) ? "analog" : "digital",
      });
    }
    return null;
  }
}
```

`KEYS` lives beside the rest of the case's fixed values, so one module holds
every name the game and its validators agree on.

```ts
export const WIDTH = 640;
export const HEIGHT = 360;
export const ARENA = { half: 60 };
export const ROVER = { speed: 14, turnRate: Math.PI };
export const AI_DEADZONE = 0.5;

export const ANALOG = new Set([
  "move-forward",
  "move-back",
  "move-left",
  "move-right",
]);

export const KEYS: Record<string, string[]> = {
  "move-forward": ["KeyW", "ArrowUp"],
  "move-back": ["KeyS", "ArrowDown"],
  "move-left": ["KeyA", "ArrowLeft"],
  "move-right": ["KeyD", "ArrowRight"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};
```

## The pawn

Subclass `Pawn` and expose the movement the pawn can perform. The constructor
attaches components and sets defaults. `drive` is the whole interface a
controller uses, and `tick` applies the intent it was given and returns the pawn
to rest. Forward is the pawn's local −Z, so its heading is its rotation and a
turn is a rotation about the world's +Y.

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

  tick(dt: number): void {
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

Subclass `PlayerController` and read the actions in `tick`. Controllers tick
before any actor, so what the controller writes here is what the pawn's own tick
applies this frame. Take a signed axis as the difference between two opposed
actions so holding both cancels out, and use `pressed` for anything that happens
once per press.

```ts
import { PlayerController } from "@test-cabinet/structured-3d";
import { Ball } from "./ball";
import { Rover } from "./rover";

export class RoverController extends PlayerController {
  tick(): void {
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

Read a given action's edge in one place per controller. The first read consumes
this controller's copy, so a second read in the same tick sees nothing, while a
second controller bound to the same action still sees the press.

The pointer stays 2D and logical. A controller that aims into the scene builds
a ray with `world.camera.ray(this.input.pointer())` and casts it with
`world.collision.raycast`, the picking composition on the
[collision page](/engines/structured-3d/usage/collision/).

## The AI controller

Subclass `AIController` and compute the same drive from the world. The reads are
the world's own object model, so the bot decides from what it can see rather
than from input.

```ts
import {
  AIController,
  rotateVec3,
  vec3Dot,
  vec3Sub,
} from "@test-cabinet/structured-3d";
import { AI_DEADZONE } from "./constants";
import { Beacon } from "./beacon";
import { Rover } from "./rover";

export class RoverBot extends AIController {
  tick(): void {
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
Both controllers finish with the same call to `drive`. What precedes it
differs, and the pawn sees one interface.

## Naming both on the game mode

The mode declares which classes it builds. `playerControllerClass` is what
`addPlayer` constructs, `pawnClass` is what both kinds of controller possess,
and `addBot` takes its controller class at the call. `spawnPoint` decides where
`restart` places a pawn, and `pawnDied` decides what a death means.

```ts
import {
  GameMode,
  quatFromAxisAngle,
  type Controller,
  type Transform,
} from "@test-cabinet/structured-3d";
import { RoverBot } from "./ai-controller";
import { RoverController } from "./player-controller";
import { Rover } from "./rover";
import { ARENA } from "./constants";

export class RallyMode extends GameMode {
  playerControllerClass = RoverController;
  pawnClass = Rover;

  beginPlay(): void {
    this.addPlayer({ name: "Player" });
    this.addBot(RoverBot, { name: "Opponent" });
    this.setPhase("playing");
  }

  spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    return {
      position: { x: left ? -ARENA.half + 4 : ARENA.half - 4, y: 0, z: 0 },
      rotation: quatFromAxisAngle(
        { x: 0, y: 1, z: 0 },
        left ? -Math.PI / 2 : Math.PI / 2,
      ),
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  pawnDied(controller: Controller): void {
    this.world.after(1, () => this.restart(controller));
  }
}
```

`addPlayer` and `addBot` each build a player state, a controller, and a pawn,
and possess. The player takes index `0` and the bot the next free index, which
is what puts one rover on each side, each rotated to face the arena's center.

## Swapping the driver

Because the two controllers write the same pawn, choosing between them is a line
in `beginPlay`. The mode's `options` carry whatever `world.open` was given, so
the same level serves one player against a bot and two players against each
other.

```ts
beginPlay(): void {
  this.addPlayer({ name: "Player 1" });

  if (this.options.twoPlayer === true) {
    this.addPlayer({ name: "Player 2" });
  } else {
    this.addBot(RoverBot, { name: "Opponent" });
  }

  this.setPhase("playing");
}
```

A validator reaches the pawn the same way: it constructs a controller of its
own, possesses the pawn with it, and steps the engine, and the pawn moves
exactly as it does under a player.
