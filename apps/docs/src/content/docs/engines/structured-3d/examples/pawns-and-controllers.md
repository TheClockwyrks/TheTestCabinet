---
title: Pawns and Controllers
---

A build with two paddles: one driven by a player through the action registry and
one driven by a computer opponent that reads the world. Both paddles are the
same class, and the side that differs is which controller holds the pawn.

## src/constants.ts

```ts
import type { ActionBinding } from "@test-cabinet/structured-3d";

export const WIDTH = 640;
export const HEIGHT = 360;

export const COURT_HALF_WIDTH = 8;
export const COURT_HALF_HEIGHT = 4;

export const PADDLE_WIDTH = 0.4;
export const PADDLE_HEIGHT = 2.4;
export const PADDLE_DEPTH = 0.4;
export const PADDLE_SPEED = 9;
export const DEAD_ZONE = 0.1;

export const LEVEL = "duel";

export const TAGS = {
  paddle: "paddle",
  player: "player-paddle",
  opponent: "opponent-paddle",
} as const;

export const ACTIONS = {
  up: "move-up",
  down: "move-down",
  restart: "confirm",
} as const;

export const BINDINGS: Record<string, ActionBinding> = {
  [ACTIONS.up]: { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  [ACTIONS.down]: { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  [ACTIONS.restart]: { keys: ["Enter", "Space"] },
};
```

`move-up` and `move-down` belong to the `single-stick` vocabulary and `confirm`
is a menu action, so all three carry the layout once the engine is built with
it. The court and the paddles are measured in world units, and the design size
alone is logical.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { HEIGHT, WIDTH } from "./constants";
import { duel } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: "#0b0f16",
  layout: "single-stick",
  game: duel,
});

await engine.initialize();
await engine.run();
```

`layout` selects the touch layout before anything is registered, so each action
in that layout's vocabulary is tagged with it as the instance registers it.

## src/game.ts

```ts
import { GameInstance } from "@test-cabinet/structured-3d";
import type { GameDefinition, InitApi } from "@test-cabinet/structured-3d";
import { BINDINGS, LEVEL } from "./constants";
import { Lamp } from "./actors/lamp";
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
  levels: { [LEVEL]: { mode: DuelMode, actors: [{ type: Lamp }] } },
  startLevel: LEVEL,
};
```

The instance registers the bindings once, before the start level opens. The
level declares one actor, the lamp that lights the court; the mode spawns both
paddles as it adds its players.

## src/actors/lamp.ts

```ts
import { Actor, LightComponent, quatFromEuler } from "@test-cabinet/structured-3d";

export class Lamp extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    const sun = this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    );
    sun.offset.rotation = quatFromEuler(-Math.PI / 4, Math.PI / 4, 0);
  }
}
```

## src/actors/paddle.ts

```ts
import { MeshComponent, Pawn, PlayerController, vec3 } from "@test-cabinet/structured-3d";
import type { Controller } from "@test-cabinet/structured-3d";
import {
  COURT_HALF_HEIGHT,
  PADDLE_DEPTH,
  PADDLE_HEIGHT,
  PADDLE_SPEED,
  PADDLE_WIDTH,
  TAGS,
} from "../constants";

export class Paddle extends Pawn {
  private direction = 0;

  constructor() {
    super();
    this.addTag(TAGS.paddle);
    this.attach(
      new MeshComponent({
        geometry: {
          kind: "box",
          width: PADDLE_WIDTH,
          height: PADDLE_HEIGHT,
          depth: PADDLE_DEPTH,
        },
        material: { color: "#e6edf6" },
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
    const limit = COURT_HALF_HEIGHT - PADDLE_HEIGHT / 2;
    const current = this.transform.position;
    const y = current.y + this.direction * PADDLE_SPEED * dt;
    this.transform.position = vec3(
      current.x,
      Math.min(Math.max(y, -limit), limit),
      current.z,
    );
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
import { PlayerController } from "@test-cabinet/structured-3d";
import { Paddle } from "../actors/paddle";
import { ACTIONS } from "../constants";

export class PaddlePlayer extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    pawn.drive(this.input.value(ACTIONS.up) - this.input.value(ACTIONS.down));

    if (this.input.pressed(ACTIONS.restart)) {
      this.world.mode.restart(this);
    }
  }
}
```

`value` is the held read: both directions are analog, so a key reports `1` while
it is down and a stick reports its deflection along that direction, and taking
the axis as the difference makes holding both report `0`. Up is `+Y` in the
world, so the axis is up minus down. `pressed` is the edge read, true once per
press and consumed by the call, so one press costs one `restart`, which
respawns the paddle at the mode's spawn point and possesses it.

## src/controllers/paddle-ai.ts

```ts
import { AIController } from "@test-cabinet/structured-3d";
import { Paddle } from "../actors/paddle";
import { DEAD_ZONE, TAGS } from "../constants";

export class PaddleAI extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    const target = this.world.byTag(TAGS.player)[0];
    if (target === undefined) return;

    const delta = target.transform.position.y - pawn.transform.position.y;
    if (Math.abs(delta) < DEAD_ZONE) return;
    pawn.drive(Math.sign(delta));
  }
}
```

The opponent reaches the same `drive` call from the world: it finds the player's
paddle by tag and chases it, and the dead zone keeps it still once aligned.

## src/levels/duel-mode.ts

```ts
import {
  GameMode,
  PlayerController,
  QUAT_IDENTITY,
  VEC3_ONE,
  vec3,
} from "@test-cabinet/structured-3d";
import type { Controller, Transform } from "@test-cabinet/structured-3d";
import { Paddle } from "../actors/paddle";
import { COURT_HALF_WIDTH } from "../constants";
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
    const x =
      controller instanceof PlayerController ? -COURT_HALF_WIDTH : COURT_HALF_WIDTH;
    return { position: vec3(x, 0, 0), rotation: QUAT_IDENTITY, scale: VEC3_ONE };
  }
}
```

`addPlayer` builds the player state, builds a `PaddlePlayer` because the options
name no controller, spawns a `Paddle` at `spawnPoint`, and possesses it.
`addBot` does the same with the `PaddleAI` it is handed. The world's camera
starts at `(0, 0, 10)` looking at the origin, so both paddles, eight units to
either side on the `z = 0` plane, are in view without the mode posing it.

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
    (this.pawn as Paddle).drive(1);
  }
}

const scripted = world.mode.addBot(HoldUp, { pawn: null });
scripted.possess(world.byTag(TAGS.player)[0] as Paddle);
await engine.advance(60);
```

`possess` unpossesses whatever controller already held that pawn, so the
player's paddle answers to the scripted controller from the next frame. The
movement rule, the frame order, and the clamp against the court are the ones a
player exercises, so the check measures the build rather than a path beside it.
