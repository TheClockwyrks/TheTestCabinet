---
title: Collision and Events
---

A build named Breaker: a ball, a paddle, a wall of bricks, and a floor that
reports the ball crossing it without stopping it. The engine finds the pairs and
reports each with a manifold; the game mode decides what every pair costs.

## src/constants.ts

```ts
import type { ColliderOptions, Shape } from "@clockwyrks/structured-2d";

export const LEVEL = "breaker";
export const FIELD = { width: 640, height: 360, wall: 16 };
export const SERVE = { x: 320, y: 240 };
export const SPEED = 260;

export const CHANNEL = {
  ball: "ball",
  brick: "brick",
  paddle: "paddle",
  wall: "wall",
  floor: "floor",
} as const;

export const BLOCK = { [CHANNEL.ball]: "block" } as const;
export const HINT_SHAPE: Shape = { kind: "circle", radius: 3 };

export const BALL_COLLIDER: ColliderOptions = {
  shape: { kind: "circle", radius: 6 },
  channel: CHANNEL.ball,
  responses: {
    [CHANNEL.brick]: "block",
    [CHANNEL.paddle]: "block",
    [CHANNEL.wall]: "block",
  },
};

export const BRICK_COLLIDER: ColliderOptions = {
  shape: { kind: "rect", width: 56, height: 18 },
  channel: CHANNEL.brick,
  responses: BLOCK,
};

export const FLOOR_COLLIDER: ColliderOptions = {
  shape: { kind: "rect", width: FIELD.width, height: FIELD.wall },
  channel: CHANNEL.floor,
  responses: { [CHANNEL.ball]: "overlap" },
};
```

The five channel names are the game's collision vocabulary and the `responses`
maps are its matrix. An unlisted channel is answered with `ignore`, and a pair
takes the stronger of the two answers, ordered `ignore`, `overlap`, `block`.

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-2d";
import { FIELD } from "./constants";
import { breaker } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: FIELD.width,
  height: FIELD.height,
  background: "#0b0f16",
  game: breaker,
});

await engine.initialize();
await engine.run();
```

## src/game.ts

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
} from "@clockwyrks/structured-2d";
import type { ActorSpec, GameDefinition } from "@clockwyrks/structured-2d";
import { Ball } from "./actors/ball";
import { Brick } from "./actors/brick";
import { Floor } from "./actors/floor";
import { BLOCK, CHANNEL, FIELD, LEVEL, SERVE } from "./constants";
import { BreakerMode } from "./levels/breaker-mode";

const { width, height, wall } = FIELD;

function bar(w: number, h: number, x: number, y: number, channel: string) {
  const shape = { kind: "rect", width: w, height: h } as const;
  return {
    type: Actor,
    transform: { x, y },
    configure(actor: Actor) {
      actor.attach(new ShapeComponent({ shape, fill: "#39465c" }));
      actor.attach(new ColliderComponent({ shape, channel, responses: BLOCK }));
    },
  };
}

const actors: ActorSpec[] = [
  bar(width, wall, width / 2, -wall / 2, CHANNEL.wall),
  bar(wall, height, -wall / 2, height / 2, CHANNEL.wall),
  bar(wall, height, width + wall / 2, height / 2, CHANNEL.wall),
  bar(72, 10, width / 2, 330, CHANNEL.paddle),
  ...Array.from({ length: 27 }, (_, i) => ({
    type: Brick,
    transform: { x: 64 + (i % 9) * 64, y: 56 + Math.floor(i / 9) * 26 },
  })),
  { type: Floor, transform: { x: width / 2, y: height + wall / 2 } },
  { type: Ball, transform: SERVE },
];

export const breaker: GameDefinition = {
  levels: { [LEVEL]: { mode: BreakerMode, actors } },
  startLevel: LEVEL,
};
```

## src/actors/ball.ts

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
} from "@clockwyrks/structured-2d";
import type { Vec2 } from "@clockwyrks/structured-2d";
import { BALL_COLLIDER, SERVE, SPEED } from "../constants";

export class Ball extends Actor {
  readonly velocity: Vec2 = { x: SPEED * 0.6, y: SPEED };

  constructor() {
    super();
    const { shape } = BALL_COLLIDER;
    this.attach(new ShapeComponent({ shape, fill: "#7fd1ff" }));
    this.attach(new ColliderComponent(BALL_COLLIDER));
  }

  override tick(dt: number): void {
    this.transform.x += this.velocity.x * dt;
    this.transform.y += this.velocity.y * dt;
  }

  serve(): void {
    Object.assign(this.transform, SERVE);
    Object.assign(this.velocity, { x: SPEED * 0.6, y: SPEED });
  }

  reflect(normal: Vec2, depth: number): void {
    this.transform.x -= normal.x * depth;
    this.transform.y -= normal.y * depth;
    const into = this.velocity.x * normal.x + this.velocity.y * normal.y;
    if (into <= 0) return;
    this.velocity.x -= 2 * into * normal.x;
    this.velocity.y -= 2 * into * normal.y;
  }
}
```

`reflect` is the whole physical response: back the ball out along the normal by
the manifold's depth, then mirror the velocity while it still moves into the
surface. A blocking pair emits `hit` on every frame it is found, and the `into`
guard is what makes the frames after the first cost nothing.

## src/actors/brick.ts

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
} from "@clockwyrks/structured-2d";
import { BRICK_COLLIDER } from "../constants";

export class Brick extends Actor {
  constructor() {
    super();
    const { shape } = BRICK_COLLIDER;
    this.attach(new ShapeComponent({ shape, fill: "#ffd479" }));
    this.attach(new ColliderComponent(BRICK_COLLIDER));
  }
}
```

## src/actors/floor.ts

```ts
import { Actor, ColliderComponent } from "@clockwyrks/structured-2d";
import { FLOOR_COLLIDER } from "../constants";

export class Floor extends Actor {
  constructor() {
    super();
    this.attach(new ColliderComponent(FLOOR_COLLIDER));
  }
}
```

The floor is a trigger: it carries a collider and no render component. The ball
answers the `floor` channel with `ignore`, so the pair settles on `overlap`. The
pair emits `overlap:begin` on the first frame it is found and `overlap:end` on
the first frame it is not, which is also emitted when either actor is destroyed
or the world closes.

## src/levels/breaker-mode.ts

```ts
import { Actor, GameMode, ShapeComponent } from "@clockwyrks/structured-2d";
import { Ball } from "../actors/ball";
import { Brick } from "../actors/brick";
import { Floor } from "../actors/floor";
import { BALL_COLLIDER, CHANNEL, HINT_SHAPE } from "../constants";

const QUERY = { channel: CHANNEL.ball, responses: BALL_COLLIDER.responses };

export class BreakerMode extends GameMode {
  lives = 3;
  private ball: Ball | null = null;
  private hint: Actor | null = null;

  override beginPlay(): void {
    const events = this.world.events;
    this.ball = this.world.find(Ball);
    this.hint = this.world.spawn(Actor, {
      configure: (dot) =>
        dot.attach(new ShapeComponent({ shape: HINT_SHAPE, fill: "#ffffff" })),
    });

    events.on("hit", ({ a, b, manifold }) => {
      const ball = this.ball;
      if (ball === null || (a !== ball && b !== ball)) return;
      const n = manifold.normal;
      ball.reflect(a === ball ? n : { x: -n.x, y: -n.y }, manifold.depth);
      const other = a === ball ? b : a;
      if (other instanceof Brick) other.destroy();
    });
    events.on("overlap:begin", ({ a, b }) => {
      if (!(a instanceof Floor) && !(b instanceof Floor)) return;
      this.lives -= 1;
      if (this.lives > 0) this.ball?.serve();
      else this.setPhase("over");
    });

    this.setPhase("playing");
  }

  override tick(): void {
    const { ball, hint } = this;
    if (ball === null || hint === null) return;
    const v = ball.velocity;
    const speed = Math.hypot(v.x, v.y) || 1;
    const aim = this.world.collision.raycast(
      ball.transform,
      { x: v.x / speed, y: v.y / speed },
      400,
      { ...QUERY, ignore: [ball] },
    );
    if (aim === null) return;
    hint.transform.x = aim.point.x;
    hint.transform.y = aim.point.y;
  }
}
```

`a` is the actor of the pair with the lower `id`, so the mode compares both
sides against the ball it cached and flips the normal when the ball is second.
The hint reads the same collision world, along the ball's heading.

## What the engine did and what the game did

The engine ran its collision pass after every actor ticked and before the mode
ticked, so a pair produced by this frame's movement is reported in that frame.
It reported the two actors, their colliders, and the manifold, and moved
nothing. Every consequence is the game's: the reflection, the brick, the life.
