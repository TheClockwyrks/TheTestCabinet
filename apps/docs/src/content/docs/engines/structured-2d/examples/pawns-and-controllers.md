---
title: Pawns and Controllers
---

A build with two paddles: one driven by a player through the action registry and
one driven by a computer opponent that reads the world. Both paddles are the
same class, and the side that differs is which controller holds the pawn.

## src/constants.ts

```ts
import type { ActionBinding } from "@clockwyrks/structured-2d";

export const WIDTH = 640;
export const HEIGHT = 360;
export const MARGIN = 48;

export const PADDLE_WIDTH = 12;
export const PADDLE_HEIGHT = 72;
export const PADDLE_SPEED = 320;
export const DEAD_ZONE = 4;

export const LEVEL = "duel";

export const TAGS = {
  paddle: "paddle",
  player: "player-paddle",
  opponent: "opponent-paddle",
} as const;

export const ACTIONS = {
  up: "p1-up",
  down: "p1-down",
  restart: "confirm",
} as const;

export const BINDINGS: Record<string, ActionBinding> = {
  [ACTIONS.up]: { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  [ACTIONS.down]: { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  [ACTIONS.restart]: { keys: ["Enter", "Space"] },
};
```

`p1-up` and `p1-down` belong to the `dual-vertical` vocabulary and `confirm` is
a menu action, so all three carry the layout once the engine is built with it.

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-2d";
import { HEIGHT, WIDTH } from "./constants";
import { duel } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: "#0b0f16",
  layout: "dual-vertical",
  game: duel,
});

await engine.initialize();
await engine.run();
```

`layout` selects the touch layout before anything is registered, so each action
in that layout's vocabulary is tagged with it as the instance registers it.

## src/game.ts

```ts
import { GameInstance } from "@clockwyrks/structured-2d";
import type { GameDefinition, InitApi } from "@clockwyrks/structured-2d";
import { BINDINGS, LEVEL } from "./constants";
import { DuelMode } from "./levels/duel-mode";

export class DuelGame extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }
    return null;
  }
}

export const duel: GameDefinition<null> = {
  instance: DuelGame,
  levels: { [LEVEL]: { mode: DuelMode } },
  startLevel: LEVEL,
};
```

The instance registers the bindings once, before the start level opens. The
level declares no actors: the mode spawns both paddles as it adds its players.

## src/actors/paddle.ts

```ts
import { Pawn, PlayerController, ShapeComponent } from "@clockwyrks/structured-2d";
import type { Controller } from "@clockwyrks/structured-2d";
import { HEIGHT, PADDLE_HEIGHT, PADDLE_SPEED, PADDLE_WIDTH, TAGS } from "../constants";

export class Paddle extends Pawn {
  private direction = 0;

  constructor() {
    super();
    this.addTag(TAGS.paddle);
    this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: PADDLE_WIDTH, height: PADDLE_HEIGHT },
        fill: "#e6edf6",
      }),
    );
  }

  drive(direction: number): void {
    this.direction = Math.min(Math.max(direction, -1), 1);
  }

  override possessedBy(controller: Controller): void {
    const side =
      controller instanceof PlayerController ? TAGS.player : TAGS.opponent;
    this.addTag(side);
  }

  override tick(dt: number): void {
    const half = PADDLE_HEIGHT / 2;
    const y = this.transform.y + this.direction * PADDLE_SPEED * dt;
    this.transform.y = Math.min(Math.max(y, half), HEIGHT - half);
    this.direction = 0;
  }
}
```

`drive` records an intent and `tick` integrates it against the delta, so the
pawn holds the movement rule and the controller holds the decision. The
direction returns to rest each tick, so a paddle stops when its controller stops
driving. `possessedBy` is where the pawn learns which side it is on.

## src/controllers/paddle-player.ts

```ts
import { PlayerController } from "@clockwyrks/structured-2d";
import { Paddle } from "../actors/paddle";
import { ACTIONS } from "../constants";

export class PaddlePlayer extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    pawn.drive(this.input.value(ACTIONS.down) - this.input.value(ACTIONS.up));

    if (this.input.pressed(ACTIONS.restart)) {
      this.world.mode.restart(this);
    }
  }
}
```

`value` is the held read: both directions are analog, so a key reports `1` while
it is down and a touch slider reports the magnitude it is pushed to, and taking
the axis as the difference makes holding both report `0`. `pressed` is the edge
read, true once per press and consumed by the call, so one press costs one
`restart`, which respawns the paddle at the mode's spawn point and possesses it.

## src/controllers/paddle-ai.ts

```ts
import { AIController } from "@clockwyrks/structured-2d";
import { Paddle } from "../actors/paddle";
import { DEAD_ZONE, TAGS } from "../constants";

export class PaddleAI extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    const target = this.world.byTag(TAGS.player)[0];
    if (target === undefined) return;

    const delta = target.transform.y - pawn.transform.y;
    if (Math.abs(delta) < DEAD_ZONE) return;
    pawn.drive(Math.sign(delta));
  }
}
```

The opponent reaches the same `drive` call from the world: it finds the player's
paddle by tag and chases it, and the dead zone keeps it still once aligned.

## src/levels/duel-mode.ts

```ts
import { GameMode, PlayerController } from "@clockwyrks/structured-2d";
import type { Controller, Transform } from "@clockwyrks/structured-2d";
import { Paddle } from "../actors/paddle";
import { HEIGHT, MARGIN, WIDTH } from "../constants";
import { PaddleAI } from "../controllers/paddle-ai";
import { PaddlePlayer } from "../controllers/paddle-player";

export class DuelMode extends GameMode {
  override playerControllerClass = PaddlePlayer;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.addPlayer({ name: "Player" });
    this.addBot(PaddleAI, { name: "Opponent" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const x = controller instanceof PlayerController ? MARGIN : WIDTH - MARGIN;
    return { x, y: HEIGHT / 2, rotation: 0, scaleX: 1, scaleY: 1 };
  }
}
```

`addPlayer` builds the player state, builds a `PaddlePlayer` because the options
name no controller, spawns a `Paddle` at `spawnPoint`, and possesses it.
`addBot` does the same with the `PaddleAI` it is handed.

## The two controllers are interchangeable

`Paddle` exposes `drive` and integrates what it is given, so a controller is
free to compute that number however it likes. `PaddlePlayer` computes it from
two actions and `PaddleAI` computes it from another actor's transform, and the
pawn behaves the same way under either.

Controllers tick before any actor, in the order they were added, so both paddles
observe a direction set this frame. Swapping the class handed to `addBot`, or
handing `addPlayer` a different `controller`, changes who decides.

## Driving a pawn from a check

A check drives the game the way a player does, with a controller of its own:

```ts
class HoldUp extends AIController {
  override tick(): void {
    (this.pawn as Paddle).drive(-1);
  }
}

const scripted = world.mode.addBot(HoldUp, { pawn: null });
scripted.possess(world.byTag(TAGS.player)[0] as Paddle);
await engine.advance(60);
```

`possess` unpossesses whatever controller already held that pawn, so the
player's paddle answers to the scripted controller from the next frame. The
movement rule, the frame order, and the clamp against the field are the ones a
player exercises, so the check measures the build rather than a path beside it.
