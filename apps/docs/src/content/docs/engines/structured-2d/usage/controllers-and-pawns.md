---
title: Controllers and Pawns
---

A pawn is a thing in the world that can be driven. A controller decides what it
does each frame. Writing the two apart is what lets one pawn class serve a
player and a computer opponent, and it is what lets a check drive a pawn by
possessing it. The [controller
surface](/engines/structured-2d/apis/controllers/) specifies both halves.

## Registering the vocabulary

Select the touch layout the case asks for when the engine is created. The
selection holds for the engine's lifetime, so every registration is attributed
against the same vocabulary.

```ts
import { createEngine } from "@clockwyrks/structured-2d";
import { game } from "./game";
import { FIELD } from "./constants";

const engine = createEngine({
  canvas,
  width: FIELD.width,
  height: FIELD.height,
  game,
  layout: "single-vertical",
});
```

Register one action per name from the game instance's `initialize`, which the
engine runs to completion before the start level opens. A key table indexed by
action name registers the layout's whole vocabulary in one pass, and the
bindings survive every level transition.

```ts
import { GameInstance, type InitApi } from "@clockwyrks/structured-2d";
import { KEYS } from "./constants";

export class Rally extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const action of api.input.layout()?.actions ?? []) {
      api.input.register(action, { keys: KEYS[action] ?? [] });
    }
    return null;
  }
}
```

`KEYS` lives beside the rest of the case's fixed values, so one module holds
every name the game and its validators agree on.

```ts
export const FIELD = { width: 1280, height: 720 };
export const PADDLE = { halfHeight: 48, speed: 520, margin: 64 };
export const AI_DEADZONE = 8;

export const KEYS: Record<string, string[]> = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
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
to rest.

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

  tick(dt: number): void {
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

Subclass `PlayerController` and read the actions in `tick`. Controllers tick
before any actor, so what the controller writes here is what the pawn's own tick
applies this frame. Take a signed axis as the difference between two directions
so holding both cancels out, and use `pressed` for anything that happens once
per press.

```ts
import { PlayerController } from "@clockwyrks/structured-2d";
import { Ball } from "./ball";
import { Paddle } from "./paddle";

export class PaddleController extends PlayerController {
  tick(): void {
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

Read a given action's edge in one place per controller. The first read consumes
this controller's copy, so a second read in the same tick sees nothing, while a
second controller bound to the same action still sees the press.

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
  tick(): void {
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
and the pawn sees one interface.

## Naming both on the game mode

The mode declares which classes it builds. `playerControllerClass` is what
`addPlayer` constructs, `pawnClass` is what both kinds of controller possess,
and `addBot` takes its controller class at the call. `spawnPoint` decides where
`restart` places a pawn, and `pawnDied` decides what a death means.

```ts
import {
  GameMode,
  type Controller,
  type Transform,
} from "@clockwyrks/structured-2d";
import { AIPaddleController } from "./ai-controller";
import { PaddleController } from "./player-controller";
import { Paddle } from "./paddle";
import { FIELD, PADDLE } from "./constants";

export class RallyMode extends GameMode {
  playerControllerClass = PaddleController;
  pawnClass = Paddle;

  beginPlay(): void {
    this.addPlayer({ name: "Player" });
    this.addBot(AIPaddleController, { name: "Opponent" });
    this.setPhase("playing");
  }

  spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    return {
      x: left ? PADDLE.margin : FIELD.width - PADDLE.margin,
      y: FIELD.height / 2,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
  }

  pawnDied(controller: Controller): void {
    this.world.after(1, () => this.restart(controller));
  }
}
```

`addPlayer` and `addBot` each build a player state, a controller, and a pawn,
and possess. The player takes index `0` and the bot the next free index, which
is what puts one paddle on each side.

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
    this.addBot(AIPaddleController, { name: "Opponent" });
  }

  this.setPhase("playing");
}
```

A validator reaches the pawn the same way: it constructs a controller of its
own, possesses the pawn with it, and steps the engine, and the pawn moves
exactly as it does under a player.
