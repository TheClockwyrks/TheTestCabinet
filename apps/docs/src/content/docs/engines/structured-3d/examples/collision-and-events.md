---
title: Collision and Events
---

A build named Breaker: a ball, a paddle, a wall of bricks, and a floor that
reports the ball crossing it without stopping it. The engine finds the pairs and
reports each with a manifold; the game mode decides what every pair costs. The
play is on the `z = 0` plane in front of the camera's default pose, and every
shape has depth, so the manifold the engine reports is a three-dimensional one.

## src/constants.ts

```ts
import { vec3 } from "@clockwyrks/structured-3d";
import type {
  ColliderOptions,
  MeshGeometry,
  Vec3,
} from "@clockwyrks/structured-3d";

export const LEVEL = "breaker";
export const FIELD = { width: 16, height: 9, depth: 1, wall: 0.5 };
export const SERVE: Vec3 = vec3(0, -1.5, 0);
export const SPEED = 6;

export const CHANNEL = {
  ball: "ball",
  brick: "brick",
  paddle: "paddle",
  wall: "wall",
  floor: "floor",
} as const;

export const BLOCK = { [CHANNEL.ball]: "block" } as const;
export const HINT_GEOMETRY: MeshGeometry = { kind: "sphere", radius: 0.08 };

export const BALL_COLLIDER: ColliderOptions = {
  shape: { kind: "sphere", radius: 0.2 },
  channel: CHANNEL.ball,
  responses: {
    [CHANNEL.brick]: "block",
    [CHANNEL.paddle]: "block",
    [CHANNEL.wall]: "block",
  },
};

export const BRICK_COLLIDER: ColliderOptions = {
  shape: { kind: "box", width: 1.5, height: 0.5, depth: FIELD.depth },
  channel: CHANNEL.brick,
  responses: BLOCK,
};

export const FLOOR_COLLIDER: ColliderOptions = {
  shape: { kind: "box", width: FIELD.width, height: FIELD.wall, depth: FIELD.depth },
  channel: CHANNEL.floor,
  responses: { [CHANNEL.ball]: "overlap" },
};
```

The five channel names are the game's collision vocabulary and the `responses`
maps are its matrix. An unlisted channel is answered with `ignore`, and a pair
takes the stronger of the two answers, ordered `ignore`, `overlap`, `block`.

Every figure is in world units. A `box` and a `sphere` carry the same fields
whether they name a `ColliderShape` or a `MeshGeometry`, so one record is handed
to the collider and to the mesh that shows it, and what the engine tests is what
the player sees.

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-3d";
import { breaker } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#0b0f16",
  game: breaker,
});

await engine.initialize();
await engine.run();
```

The camera stays at its defaults, at `(0, 0, 10)` looking along `-Z`, so a field
centered on the origin is in view without the game posing anything. A
perspective camera with a `fov` of `60` sees about eleven and a half world units
vertically on the `z = 0` plane from there, which the nine-unit field and its
walls fit inside.

## src/game.ts

```ts
import {
  Actor,
  ColliderComponent,
  LightComponent,
  MeshComponent,
  quatLookAt,
  vec3,
} from "@clockwyrks/structured-3d";
import type { ActorSpec, GameDefinition, Vec3 } from "@clockwyrks/structured-3d";
import { Ball } from "./actors/ball";
import { Brick } from "./actors/brick";
import { Floor } from "./actors/floor";
import { BLOCK, CHANNEL, FIELD, LEVEL, SERVE } from "./constants";
import { BreakerMode } from "./levels/breaker-mode";

const { width, height, depth, wall } = FIELD;

function bar(w: number, h: number, position: Vec3, channel: string): ActorSpec {
  const shape = { kind: "box", width: w, height: h, depth } as const;
  return {
    type: Actor,
    transform: { position },
    configure(actor: Actor) {
      actor.attach(new MeshComponent({ geometry: shape, material: { color: "#39465c" } }));
      actor.attach(new ColliderComponent({ shape, channel, responses: BLOCK }));
    },
  };
}

const lights: ActorSpec = {
  type: Actor,
  transform: { rotation: quatLookAt(vec3(-0.4, -1, -0.6)) },
  configure(actor: Actor) {
    actor.attach(new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }));
    actor.attach(new LightComponent({ light: { kind: "directional", intensity: 2 } }));
  },
};

const actors: ActorSpec[] = [
  lights,
  bar(width + 2 * wall, wall, vec3(0, height / 2 + wall / 2, 0), CHANNEL.wall),
  bar(wall, height, vec3(-(width / 2 + wall / 2), 0, 0), CHANNEL.wall),
  bar(wall, height, vec3(width / 2 + wall / 2, 0, 0), CHANNEL.wall),
  bar(2, 0.3, vec3(0, -3.6, 0), CHANNEL.paddle),
  ...Array.from({ length: 27 }, (_, i) => ({
    type: Brick,
    transform: {
      position: vec3(-6.4 + (i % 9) * 1.6, 3.4 - Math.floor(i / 9) * 0.7, 0),
    },
  })),
  { type: Floor, transform: { position: vec3(0, -(height / 2 + wall / 2), 0) } },
  { type: Ball, transform: { position: SERVE } },
];

export const breaker: GameDefinition = {
  levels: { [LEVEL]: { mode: BreakerMode, actors } },
  startLevel: LEVEL,
};
```

A spec's `transform` is a `Partial<Transform>`, so a bar gives its position
alone and takes the identity rotation and unit scale. The lights actor gives a
rotation alone: a directional light shines along its component's world forward
axis, and `quatLookAt` is the rotation that turns `FORWARD` onto the direction
given, so the light falls down and into the field from the upper right. The
hemisphere light has no position and fills in what the directional light leaves
dark.

## src/actors/ball.ts

```ts
import {
  Actor,
  ColliderComponent,
  MeshComponent,
  add,
  dot,
  scale,
  sub,
  vec3,
} from "@clockwyrks/structured-3d";
import type { Vec3 } from "@clockwyrks/structured-3d";
import { BALL_COLLIDER, SERVE, SPEED } from "../constants";

export class Ball extends Actor {
  velocity: Vec3 = vec3(SPEED * 0.6, SPEED, 0);

  constructor() {
    super();
    const { shape } = BALL_COLLIDER;
    this.attach(
      new MeshComponent({
        geometry: shape,
        material: { color: "#7fd1ff", roughness: 0.4 },
      }),
    );
    this.attach(new ColliderComponent(BALL_COLLIDER));
  }

  override tick(dt: number): void {
    this.transform.position = add(this.transform.position, scale(this.velocity, dt));
  }

  serve(): void {
    this.transform.position = vec3(SERVE.x, SERVE.y, SERVE.z);
    this.velocity = vec3(SPEED * 0.6, SPEED, 0);
  }

  reflect(normal: Vec3, depth: number): void {
    this.transform.position = sub(this.transform.position, scale(normal, depth));
    const into = dot(this.velocity, normal);
    if (into <= 0) return;
    this.velocity = sub(this.velocity, scale(normal, 2 * into));
  }
}
```

`reflect` is the whole physical response: back the ball out along the normal by
the manifold's depth, then mirror the velocity while it still moves into the
surface. A blocking pair emits `hit` on every frame it is found, and the `into`
guard is what makes the frames after the first cost nothing. The math helpers
return fresh records, so each step is an assignment to `position` or to
`velocity`, and the normal is used whole: a ball that met a surface at an angle
out of the plane would leave it along the reflected direction in three axes.

## src/actors/brick.ts

```ts
import {
  Actor,
  ColliderComponent,
  MeshComponent,
} from "@clockwyrks/structured-3d";
import { BRICK_COLLIDER } from "../constants";

export class Brick extends Actor {
  constructor() {
    super();
    const { shape } = BRICK_COLLIDER;
    this.attach(new MeshComponent({ geometry: shape, material: { color: "#ffd479" } }));
    this.attach(new ColliderComponent(BRICK_COLLIDER));
  }
}
```

## src/actors/floor.ts

```ts
import { Actor, ColliderComponent } from "@clockwyrks/structured-3d";
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
  MeshComponent,
  length,
  normalize,
  scale,
} from "@clockwyrks/structured-3d";
import { Ball } from "../actors/ball";
import { Brick } from "../actors/brick";
import { Floor } from "../actors/floor";
import { BALL_COLLIDER, CHANNEL, HINT_GEOMETRY } from "../constants";

const QUERY = { channel: CHANNEL.ball, responses: BALL_COLLIDER.responses };

export class BreakerMode extends GameMode {
  lives = 3;
  private ball: Ball | null = null;
  private hint: Actor | null = null;

  override beginPlay(): void {
    const events = this.world.events;
    this.ball = this.world.find(Ball);
    this.hint = this.world.spawn(Actor, {
      configure: (marker) =>
        marker.attach(
          new MeshComponent({
            geometry: HINT_GEOMETRY,
            material: { kind: "basic", color: "#ffffff" },
          }),
        ),
    });

    events.on("hit", ({ a, b, manifold }) => {
      const ball = this.ball;
      if (ball === null || (a !== ball && b !== ball)) return;
      const n = manifold.normal;
      ball.reflect(a === ball ? n : scale(n, -1), manifold.depth);
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
    if (length(ball.velocity) === 0) return;
    const aim = this.world.collision.raycast(
      ball.transform.position,
      normalize(ball.velocity),
      40,
      { ...QUERY, ignore: [ball] },
    );
    if (aim === null) return;
    hint.transform.position = aim.point;
  }
}
```

`a` is the actor of the pair with the lower `id`, so the mode compares both
sides against the ball it cached and flips the normal when the ball is second.
The hint reads the same collision world, along the ball's heading: the ray's
`direction` is a unit vector, `distance` bounds it in world units, and the hit's
`point` is where the ray meets the nearest collider the query answers. The hint
is an unlit sphere, so it reads as a marker under any lighting.

## What the engine did and what the game did

The engine ran its collision pass after every actor ticked and before the mode
ticked, so a pair produced by this frame's movement is reported in that frame.
It reported the two actors, their colliders, and the manifold, and moved
nothing. Every consequence is the game's: the reflection, the brick, the life.

The manifold's `normal`, `depth`, and `point` are all three-dimensional. Every
box in Breaker is centered on `z = 0` and deeper than the ball is wide, so the
normal the sphere-against-box test reports lies in the `XY` plane and the ball's
`z` stays at zero, and the game did nothing to keep it there. A brick tilted out
of the plane would report a normal with a `z` component, and the same `reflect`
would send the ball out of the plane along it.
