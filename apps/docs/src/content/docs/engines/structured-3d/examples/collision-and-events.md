---
title: Collision and Events
---

A build named Breaker: a ball loose in a walled box, a paddle guarding the open
bottom, a grid of bricks overhead, and a floor that reports the ball crossing it
without stopping it. The engine finds the pairs and reports each with a
manifold; the game mode decides what every pair costs.

## src/constants.ts

```ts
import type { ColliderOptions, Shape3, Vec3 } from "@test-cabinet/structured-3d";

export const LEVEL = "breaker";
export const DESIGN = { width: 640, height: 360 };
export const FIELD = { halfX: 8, halfZ: 5, top: 10, wall: 1 };
export const SERVE: Vec3 = { x: 0, y: 5, z: 0 };
export const SPEED = 8;

export const CHANNEL = {
  ball: "ball",
  brick: "brick",
  paddle: "paddle",
  wall: "wall",
  floor: "floor",
} as const;

export const BLOCK = { [CHANNEL.ball]: "block" } as const;
export const HINT_SHAPE: Shape3 = { kind: "sphere", radius: 0.15 };

export const BALL_COLLIDER: ColliderOptions = {
  shape: { kind: "sphere", radius: 0.4 },
  channel: CHANNEL.ball,
  responses: {
    [CHANNEL.brick]: "block",
    [CHANNEL.paddle]: "block",
    [CHANNEL.wall]: "block",
  },
};

export const BRICK_COLLIDER: ColliderOptions = {
  shape: { kind: "box", size: { x: 1.4, y: 0.7, z: 2 } },
  channel: CHANNEL.brick,
  responses: BLOCK,
};

export const FLOOR_COLLIDER: ColliderOptions = {
  shape: { kind: "box", size: { x: 16, y: 1, z: 10 } },
  channel: CHANNEL.floor,
  responses: { [CHANNEL.ball]: "overlap" },
};
```

The five channel names are the game's collision vocabulary and the `responses`
maps are its matrix. An unlisted channel is answered with `ignore`, and a pair
takes the stronger of the two answers, ordered `ignore`, `overlap`, `block`.
Every shape is a volume: the ball is a sphere and everything else a box,
positioned and oriented by its component's world transform. The world's sizes
are the game's own units; the `DESIGN` size is the logical field the camera
projects into, not the arena.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { DESIGN } from "./constants";
import { breaker } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: DESIGN.width,
  height: DESIGN.height,
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
} from "@test-cabinet/structured-3d";
import type { ActorSpec, GameDefinition, Vec3 } from "@test-cabinet/structured-3d";
import { Ball } from "./actors/ball";
import { Brick } from "./actors/brick";
import { Floor } from "./actors/floor";
import { BLOCK, CHANNEL, FIELD, LEVEL, SERVE } from "./constants";
import { BreakerMode } from "./levels/breaker-mode";

const { halfX, halfZ, top, wall } = FIELD;

function slab(size: Vec3, position: Vec3, channel: string) {
  const shape = { kind: "box", size } as const;
  return {
    type: Actor,
    transform: { position },
    configure(actor: Actor) {
      actor.attach(new ShapeComponent({ shape, color: "#39465c" }));
      actor.attach(new ColliderComponent({ shape, channel, responses: BLOCK }));
    },
  };
}

const actors: ActorSpec[] = [
  slab(
    { x: 2 * halfX, y: wall, z: 2 * halfZ },
    { x: 0, y: top + wall / 2, z: 0 },
    CHANNEL.wall,
  ),
  slab(
    { x: wall, y: top, z: 2 * halfZ },
    { x: -halfX - wall / 2, y: top / 2, z: 0 },
    CHANNEL.wall,
  ),
  slab(
    { x: wall, y: top, z: 2 * halfZ },
    { x: halfX + wall / 2, y: top / 2, z: 0 },
    CHANNEL.wall,
  ),
  slab(
    { x: 2 * halfX, y: top, z: wall },
    { x: 0, y: top / 2, z: -halfZ - wall / 2 },
    CHANNEL.wall,
  ),
  slab(
    { x: 2 * halfX, y: top, z: wall },
    { x: 0, y: top / 2, z: halfZ + wall / 2 },
    CHANNEL.wall,
  ),
  slab({ x: 3, y: 0.5, z: 2 }, { x: 0, y: 1, z: 0 }, CHANNEL.paddle),
  ...Array.from({ length: 27 }, (_, i) => ({
    type: Brick,
    transform: {
      position: {
        x: -6.4 + (i % 9) * 1.6,
        y: 8,
        z: -2.4 + Math.floor(i / 9) * 2.4,
      },
    },
  })),
  { type: Floor, transform: { position: { x: 0, y: -0.5, z: 0 } } },
  { type: Ball, transform: { position: SERVE } },
];

export const breaker: GameDefinition = {
  levels: { [LEVEL]: { mode: BreakerMode, actors } },
  startLevel: LEVEL,
};
```

The five wall slabs close every face of the box except the bottom, which the
paddle guards. An `ActorSpec.transform` is a partial transform, and a supplied
`position` replaces the whole vector, so each spec states all three numbers.

## src/actors/ball.ts

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
  vec3Dot,
  vec3Scale,
  vec3Sub,
} from "@test-cabinet/structured-3d";
import type { Vec3 } from "@test-cabinet/structured-3d";
import { BALL_COLLIDER, SERVE, SPEED } from "../constants";

export class Ball extends Actor {
  velocity: Vec3 = { x: SPEED * 0.6, y: -SPEED, z: SPEED * 0.3 };

  constructor() {
    super();
    const { shape } = BALL_COLLIDER;
    this.attach(new ShapeComponent({ shape, color: "#7fd1ff" }));
    this.attach(new ColliderComponent(BALL_COLLIDER));
  }

  override tick(dt: number): void {
    const position = this.transform.position;
    position.x += this.velocity.x * dt;
    position.y += this.velocity.y * dt;
    position.z += this.velocity.z * dt;
  }

  serve(): void {
    this.transform.position = { ...SERVE };
    this.velocity = { x: SPEED * 0.6, y: -SPEED, z: SPEED * 0.3 };
  }

  reflect(normal: Vec3, depth: number): void {
    this.transform.position = vec3Sub(
      this.transform.position,
      vec3Scale(normal, depth),
    );
    const into = vec3Dot(this.velocity, normal);
    if (into <= 0) return;
    this.velocity = vec3Sub(this.velocity, vec3Scale(normal, 2 * into));
  }
}
```

`reflect` is the whole physical response: back the ball out along the normal by
the manifold's depth, then mirror the velocity while it still moves into the
surface. A blocking pair emits `hit` on every frame it is found, and the `into`
guard is what makes the frames after the first cost nothing. The arithmetic is
the shared vector functions, which return fresh values, so the assignments are
what move the actor.

## src/actors/brick.ts

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
} from "@test-cabinet/structured-3d";
import { BRICK_COLLIDER } from "../constants";

export class Brick extends Actor {
  constructor() {
    super();
    const { shape } = BRICK_COLLIDER;
    this.attach(new ShapeComponent({ shape, color: "#ffd479" }));
    this.attach(new ColliderComponent(BRICK_COLLIDER));
  }
}
```

## src/actors/floor.ts

```ts
import { Actor, ColliderComponent } from "@test-cabinet/structured-3d";
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
import {
  Actor,
  GameMode,
  ShapeComponent,
  vec3Length,
  vec3Scale,
} from "@test-cabinet/structured-3d";
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
    this.world.camera.position = { x: 0, y: 7, z: 16 };
    this.world.camera.lookAt({ x: 0, y: 5, z: 0 });

    const events = this.world.events;
    this.ball = this.world.find(Ball);
    this.hint = this.world.spawn(Actor, {
      configure: (dot) =>
        dot.attach(new ShapeComponent({ shape: HINT_SHAPE, color: "#ffffff" })),
    });

    events.on("hit", ({ a, b, manifold }) => {
      const ball = this.ball;
      if (ball === null || (a !== ball && b !== ball)) return;
      const n = manifold.normal;
      ball.reflect(a === ball ? n : vec3Scale(n, -1), manifold.depth);
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
    const speed = vec3Length(ball.velocity) || 1;
    const aim = this.world.collision.raycast(
      ball.transform.position,
      vec3Scale(ball.velocity, 1 / speed),
      40,
      { ...QUERY, ignore: [ball] },
    );
    if (aim === null) return;
    hint.transform.position = { ...aim.point };
  }
}
```

`a` is the actor of the pair with the lower `id`, so the mode compares both
sides against the ball it cached and flips the normal when the ball is second.
The hint reads the same collision world, along the ball's heading. `beginPlay`
also frames the arena: the camera is part of the world, so the mode places it
and aims it with `lookAt` before the first frame draws.

## What the engine did and what the game did

The engine ran its collision pass after every actor ticked and before the mode
ticked, so a pair produced by this frame's movement is reported in that frame.
It reported the two actors, their colliders, and the manifold, and moved
nothing. Every consequence is the game's: the reflection, the brick, the life.
