---
title: Game Mode and Scoring
---

Rally is a two-player match played to a score limit. Two paddles are pawns, each
possessed by a controller that reads its own stick of the action vocabulary. The
game mode awards the points, restarts the pawns, and ends the match.

## src/constants.ts

```ts
import type { ActionBinding } from "@clockwyrks/structured-3d";

export const WIDTH = 640;
export const HEIGHT = 360;
export const BACKGROUND = "#0b0f16";

export const LEVELS = { rally: "rally" } as const;
export const TAGS = { ball: "ball", paddle: "paddle" } as const;
export const CUES = { point: "point" } as const;
export const COLORS = { ball: "#ffd479", paddle: "#7fd1ff" } as const;

export const SCORE_LIMIT = 7;
export const COURT = { halfWidth: 10, halfHeight: 5 };
export const PADDLE = { width: 0.4, height: 2.4, depth: 0.4, inset: 1, speed: 9 };
export const BALL = { radius: 0.25, speed: 8, drift: 3 };

export const AXES: readonly (readonly [up: string, down: string])[] = [
  ["move-up", "move-down"],
  ["look-up", "look-down"],
];

export const ACTIONS: Record<string, ActionBinding> = {
  "move-up": { keys: ["KeyW"], kind: "analog" },
  "move-down": { keys: ["KeyS"], kind: "analog" },
  "look-up": { keys: ["ArrowUp"], kind: "analog" },
  "look-down": { keys: ["ArrowDown"], kind: "analog" },
};
```

The court, the paddles, and the ball are measured in world units. The two sticks
of the `dual-stick` layout give each player a vertical axis: the left stick's
`move-up` and `move-down` drive player `0` and the right stick's `look-up` and
`look-down` drive player `1`, and all four are registered analog so a stick's
deflection reaches the paddle as a magnitude.

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-3d";
import { BACKGROUND, HEIGHT, WIDTH } from "./constants";
import { rally } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  background: BACKGROUND,
  layout: "dual-stick",
  game: rally,
});

await engine.initialize();
await engine.run();
```

## src/game.ts

```ts
import { GameInstance, type InitApi } from "@clockwyrks/structured-3d";
import type { GameDefinition } from "@clockwyrks/structured-3d";
import { ACTIONS, CUES, LEVELS, TAGS } from "./constants";
import { Ball } from "./actors/ball";
import { Lamp } from "./actors/lamp";
import { RallyMode } from "./levels/rally-mode";

class RallyInstance extends GameInstance<null> {
  matches = 0;

  override initialize(api: InitApi): null {
    for (const [name, binding] of Object.entries(ACTIONS)) {
      api.input.register(name, binding);
    }
    api.audio.define(CUES.point, { freq: 660, freqTo: 440, durationMs: 90 });
    api.diagnostics.register("matches", () => this.matches);
    api.events.on("match:phase", ({ phase }) => {
      if (phase === "over") this.matches += 1;
    });
    return null;
  }
}

export const rally: GameDefinition<null> = {
  instance: RallyInstance,
  levels: {
    [LEVELS.rally]: {
      mode: RallyMode,
      actors: [{ type: Lamp }, { type: Ball, tags: [TAGS.ball] }],
    },
  },
  startLevel: LEVELS.rally,
};
```

## src/state.ts

```ts
import { GameState, PlayerState } from "@clockwyrks/structured-3d";
import type { World } from "@clockwyrks/structured-3d";

export class RallyPlayerState extends PlayerState {
  aces = 0;
}

export class RallyState extends GameState {
  declare readonly players: readonly RallyPlayerState[];
  rallies = 0;
}

export function rallyState(world: World): RallyState {
  return world.state as RallyState;
}
```

## src/actors/lamp.ts

```ts
import { Actor, LightComponent, quatFromEuler } from "@clockwyrks/structured-3d";

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

## src/actors/ball.ts

```ts
import {
  Actor,
  ColliderComponent,
  MeshComponent,
  add,
  scale,
  vec3,
} from "@clockwyrks/structured-3d";
import type { Vec3 } from "@clockwyrks/structured-3d";
import { BALL, COLORS, COURT, TAGS } from "../constants";
import { rallyState } from "../state";

const SHAPE = { kind: "sphere", radius: BALL.radius } as const;

export class Ball extends Actor {
  readonly body = this.attach(
    new MeshComponent({ geometry: SHAPE, material: { color: COLORS.ball } }),
  );
  readonly collider = this.attach(
    new ColliderComponent({ shape: SHAPE, responses: { default: "overlap" } }),
  );

  velocity: Vec3 = vec3(0, 0, 0);
  private lastHit = 0;

  override beginPlay(): void {
    this.serve(1);
  }

  serve(direction: number): void {
    this.transform.position = vec3(0, 0, 0);
    this.velocity = vec3(BALL.speed * direction, BALL.drift, 0);
    this.lastHit = 0;
  }

  override tick(dt: number): void {
    this.transform.position = add(this.transform.position, scale(this.velocity, dt));
    const limit = COURT.halfHeight - BALL.radius;
    const y = this.transform.position.y;
    if (y < -limit || y > limit) {
      this.velocity = vec3(this.velocity.x, -this.velocity.y, 0);
    }
    for (const contact of this.world.collision.overlaps(this)) {
      if (!contact.actor.hasTag(TAGS.paddle)) continue;
      if (contact.actor.id === this.lastHit) continue;
      this.lastHit = contact.actor.id;
      const away = Math.sign(
        this.transform.position.x - contact.actor.transform.position.x,
      );
      this.velocity = vec3(Math.abs(this.velocity.x) * away, this.velocity.y, 0);
      rallyState(this.world).rallies += 1;
    }
  }
}
```

One sphere literal serves as the mesh's geometry and the collider's shape, so the
ball collides with exactly what it draws. Both colliders sit on the default
channel and answer it with `overlap`, so the engine reports the pair and moves
nothing. Reflecting off the paddle and counting the contact are the ball's own
rules, and each move is an assignment of a fresh vector from the math helpers.

## src/actors/paddle.ts

```ts
import { ColliderComponent, MeshComponent, Pawn } from "@clockwyrks/structured-3d";
import { COLORS, PADDLE, TAGS } from "../constants";

const SHAPE = {
  kind: "box",
  width: PADDLE.width,
  height: PADDLE.height,
  depth: PADDLE.depth,
} as const;

export class Paddle extends Pawn {
  readonly body = this.attach(
    new MeshComponent({ geometry: SHAPE, material: { color: COLORS.paddle } }),
  );
  readonly collider = this.attach(
    new ColliderComponent({ shape: SHAPE, responses: { default: "overlap" } }),
  );

  constructor() {
    super();
    this.addTag(TAGS.paddle);
  }
}
```

The paddle carries its shape, its collider, and its tag. It reads no action of
its own, so both paddles are one class driven by two controllers.

## src/levels/rally-mode.ts

```ts
import {
  GameMode,
  PlayerController,
  QUAT_IDENTITY,
  VEC3_ONE,
  vec3,
} from "@clockwyrks/structured-3d";
import type { Controller, Transform } from "@clockwyrks/structured-3d";
import { AXES, COURT, CUES, PADDLE, SCORE_LIMIT } from "../constants";
import { Ball } from "../actors/ball";
import { Paddle } from "../actors/paddle";
import { RallyPlayerState, RallyState } from "../state";

class PaddleController extends PlayerController {
  override tick(dt: number): void {
    const pawn = this.pawn;
    const axis = AXES[this.index];
    if (pawn === null || axis === undefined) return;
    const dir = this.input.value(axis[0]) - this.input.value(axis[1]);
    const limit = COURT.halfHeight - PADDLE.height / 2;
    const current = pawn.transform.position;
    const y = current.y + dir * PADDLE.speed * dt;
    pawn.transform.position = vec3(current.x, Math.min(Math.max(y, -limit), limit), 0);
  }
}

export class RallyMode extends GameMode {
  declare readonly state: RallyState;

  override gameStateClass = RallyState;
  override playerStateClass = RallyPlayerState;
  override playerControllerClass = PaddleController;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.addPlayer({ index: 0, name: "left" });
    this.addPlayer({ index: 1, name: "right" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const left = controller.playerState.index === 0;
    const x = left ? PADDLE.inset - COURT.halfWidth : COURT.halfWidth - PADDLE.inset;
    return { position: vec3(x, 0, 0), rotation: QUAT_IDENTITY, scale: VEC3_ONE };
  }

  override tick(): void {
    if (this.phase !== "playing") return;
    const ball = this.world.find(Ball);
    if (ball === null) return;
    const x = ball.transform.position.x;
    if (Math.abs(x) <= COURT.halfWidth) return;

    const scorer = this.state.players[x < 0 ? 1 : 0];
    if (scorer === undefined) return;
    scorer.score += 1;
    if (this.state.rallies === 0) scorer.aces += 1;
    this.state.rallies = 0;
    this.world.audio.play(CUES.point, { at: ball.transform.position });

    if (scorer.score >= SCORE_LIMIT) {
      this.setPhase("over");
      return;
    }
    ball.serve(x < 0 ? 1 : -1);
    for (const controller of this.world.players()) this.restart(controller);
  }
}
```

`gameStateClass` is read once, when the world is built, and `playerStateClass`
on each `addPlayer`. `addPlayer` builds the player state, the controller, and
the pawn, and possesses, so `beginPlay`, which runs after the declared ball has
begun play, is where a paddle first exists. `spawnPoint` returns a whole
transform, and the court is centered on the origin, so the world's default
camera at `(0, 0, 10)` sees both paddles and the whole court without the mode
posing it.

The mode ticks after every actor has ticked and after collision has been
reported, so it decides the point from a settled world. `restart` destroys a
controller's pawn, spawns `pawnClass` at `spawnPoint(controller)`, and possesses
it. The point cue is played with `at`, so it sounds from the side of the court
the ball left, heard from the camera.

## The match phase

A mode's `phase` is `"waiting"` when it begins play, so a mode that starts its
match at once calls `setPhase("playing")` from `beginPlay`. `setPhase` sets the
phase, writes it onto the game state, and emits `match:phase` carrying the new
phase and the previous one. Setting the phase the mode already holds emits
nothing. `RallyMode` reaches `"over"` on the point that meets the score limit,
which is where its `tick` stops scoring and where `RallyInstance` counts the
match from its `match:phase` subscription.

## Where each figure lives

| Figure | Holder | Rebuilt |
| --- | --- | --- |
| `phase`, `elapsed`, `rallies` | `RallyState` | With the world |
| `index`, `name`, `score`, `aces` | `RallyPlayerState` | On each `addPlayer` |
| `matches` | `RallyInstance` | Never |

A figure that describes the match belongs to the game state. `rallies` is read
by the ball and by the mode and means nothing outside this match, so it sits
beside `phase` and `elapsed`, the match clock that accumulates only while the
phase is `"playing"`.

A figure that answers which player belongs to a player state. The engine builds
one per `addPlayer` and `addBot` call and holds them in index order on
`state.players`, beside the `index`, `name`, and `score` every one carries.

A figure that outlives the match belongs to the game instance. `matches` counts
what no single world can see, and the instance is the one framework object kept
across a level transition, so its diagnostic source outlives the match too.
