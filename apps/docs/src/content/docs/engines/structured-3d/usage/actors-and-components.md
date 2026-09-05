---
title: Actors and Components
---

A build writes one class per thing in the world. The class extends `Actor`,
attaches its components in the constructor, keeps a field for each one, and
overrides the lifecycle methods it needs. Everything else about the actor is
ordinary TypeScript.

## An actor is a class with components

Attach in the constructor, hold the result, and set the fields the actor starts
with. `attach` returns the component it was given, so the field is assigned and
attached in one statement.

```ts
import {
  Actor,
  ColliderComponent,
  MeshComponent,
} from "@clockwyrks/structured-3d";
import { LAYER, PADDLE, PALETTE, TAGS } from "./constants";

export class Paddle extends Actor {
  readonly body: MeshComponent;
  readonly collider: ColliderComponent;
  velocityY = 0;

  constructor() {
    super();

    this.body = this.attach(
      new MeshComponent({
        geometry: {
          kind: "box",
          width: PADDLE.width,
          height: PADDLE.height,
          depth: PADDLE.depth,
        },
        material: { color: PALETTE.paddle, roughness: 0.6 },
      }),
    );
    this.body.layer = LAYER.actors;

    this.collider = this.attach(
      new ColliderComponent({
        shape: {
          kind: "box",
          width: PADDLE.width,
          height: PADDLE.height,
          depth: PADDLE.depth,
        },
        channel: "paddle",
        responses: { ball: "block" },
      }),
    );

    this.addTag(TAGS.paddle);
  }
}
```

The constructor runs before the actor has a world, so it confines itself to the
actor's own contents. Anything that reads `this.world` or another actor belongs
in `beginPlay`. The mesh and the collider state the same box in the actor's own
axes, so the shape the engine tests is the shape the pipeline draws.

## Placing actors and spawning them

A level declares the actors it places, and the world spawns anything that
appears later.

```ts
import type { LevelDefinition } from "@clockwyrks/structured-3d";
import { vec3 } from "@clockwyrks/structured-3d";
import { Match } from "./mode";
import { Ball } from "./ball";
import { Paddle } from "./paddle";
import { COURT, TAGS } from "./constants";

export const court: LevelDefinition = {
  mode: Match,
  actors: [
    {
      type: Paddle,
      transform: { position: vec3(-COURT.halfWidth + 1, 0, 0) },
      tags: [TAGS.left],
    },
    { type: Paddle, transform: { position: vec3(COURT.halfWidth - 1, 0, 0) } },
    { type: Ball, transform: { position: vec3(0, 0, 0) } },
  ],
};
```

`world.spawn` returns a live actor that has already begun play, so the caller
configures it, stores it, or reads it back immediately.

```ts
const shard = this.world.spawn(Shard, {
  transform: { position: { ...this.transform.position } },
  tags: [TAGS.debris],
  configure: (s) => {
    s.velocity = vec3(Math.cos(angle) * 9, 3, Math.sin(angle) * 9);
  },
});
```

`configure` runs before the actor begins play, so a field the actor's own
`beginPlay` reads is set through it rather than after `spawn` returns. A spec's
`position` is given whole, so a spawn that starts where another actor stands
hands over a copy of that actor's position rather than the record it moves.

## Finding peers in `beginPlay`

Every actor a level declares exists before any `beginPlay` runs, so this is
where an actor looks up the rest of the world. Find by tag when a case fixed the
vocabulary, and by type when the class is the build's own.

```ts
import { Actor } from "@clockwyrks/structured-3d";
import { Ball } from "./ball";
import { TAGS } from "./constants";

export class Goal extends Actor {
  private ball: Ball | null = null;
  private posts: readonly Actor[] = [];

  beginPlay(): void {
    this.ball = this.world.find(Ball);
    this.posts = this.world.byTag(TAGS.post);
  }
}
```

`find` returns the first match or `null`. `ofType` returns every live instance
of a class and `byTag` every live actor carrying a tag, both in spawn order and
as a copy the caller owns.

## Moving in `tick`

`tick` receives the frame's delta in seconds. Write every speed, acceleration,
and cooldown per second, and multiply by the delta. The
[vector helpers](/engines/structured-3d/apis/math/) are pure, so a step is the
sum of the position and the scaled velocity, assigned back onto the transform.

```ts
import { Actor, add, scale, vec3, type Vec3 } from "@clockwyrks/structured-3d";
import { COURT, BALL_SPEED } from "./constants";

export class Ball extends Actor {
  velocity: Vec3 = vec3(BALL_SPEED, BALL_SPEED * 0.4, 0);

  tick(dt: number): void {
    this.transform.position = add(this.transform.position, scale(this.velocity, dt));

    const { y } = this.transform.position;
    if (y < -COURT.halfHeight || y > COURT.halfHeight) {
      this.velocity = vec3(this.velocity.x, -this.velocity.y, this.velocity.z);
      this.world.audio.play("bounce", { at: this.transform.position });
    }
  }
}
```

The transform is mutable in place, so movement is an assignment. Set
`tickEnabled` to `false` to park an actor and its components without removing
them, and `tickWhenPaused` to `true` for an actor that must keep running while
the world is paused.

## Turning

A rotation is a unit quaternion, and the actor's forward axis is `FORWARD`
rotated by it. `quatFromAxisAngle` builds the frame's turn, `quatMultiply`
composes it with the rotation the actor already holds, and `quatRotate` reads
the heading back out, so the turn and the step come from one quaternion.

```ts
import {
  Actor,
  FORWARD,
  UP,
  add,
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
  scale,
} from "@clockwyrks/structured-3d";
import { SHIP } from "./constants";

export class Ship extends Actor {
  turn = 0;
  throttle = 0;

  tick(dt: number): void {
    const yaw = quatFromAxisAngle(UP, this.turn * SHIP.turnRate * dt);
    this.transform.rotation = quatMultiply(yaw, this.transform.rotation);

    const heading = quatRotate(this.transform.rotation, FORWARD);
    const step = scale(heading, this.throttle * SHIP.speed * dt);
    this.transform.position = add(this.transform.position, step);
  }
}
```

`quatMultiply(yaw, rotation)` applies the existing rotation first and the turn
second, so the turn is about the world's up axis whatever attitude the ship
holds. A turn in the ship's own axes, a roll about its own forward axis for one,
goes on the right instead, `quatMultiply(rotation, roll)`. A heading a game
keeps as a single angle is written with `quatFromEuler(0, yaw, 0)` and read back
with `quatToEuler(rotation).y`.

## A component with its own tick

Behavior that belongs to a piece rather than to the whole actor goes in a
component. A component extends `Component`, takes whatever constructor arguments
it needs, and reads its actor through `this.actor`.

```ts
import { Component, vec3 } from "@clockwyrks/structured-3d";

export class Bob extends Component {
  private elapsed = 0;

  constructor(
    private readonly amplitude: number,
    private readonly period: number,
  ) {
    super();
  }

  tick(dt: number): void {
    this.elapsed += dt;
    const phase = (this.elapsed / this.period) * Math.PI * 2;
    this.offset.position = vec3(0, Math.sin(phase) * this.amplitude, 0);
  }
}
```

Writing `offset` moves the component relative to its actor, so a pickup bobs
while its actor stays where the level placed it. Attach it like any other
component:

```ts
import { Actor, MeshComponent } from "@clockwyrks/structured-3d";
import { Bob } from "./bob";
import { PALETTE } from "./constants";

export class Pickup extends Actor {
  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "sphere", radius: 0.3 },
        material: { color: PALETTE.coin, emissive: PALETTE.coinGlow },
      }),
    );
    this.attach(new Bob(0.2, 1.2));
  }
}
```

Components tick in attachment order, immediately after their actor's own tick.
Set `enabled` to `false` on a component to drop its tick, its drawing, and its
collision together.

## Mounting with an offset

An offset is a whole transform, so a component rides its actor at a position,
a rotation, and a scale of its own. The engine composes the two as scale, then
rotation, then translation, and a render component, a collider, and a camera
component are all placed at the composed result, so a piece mounted on an
offset moves and turns with its actor and still turns on its own.

```ts
import {
  Actor,
  MeshComponent,
  UP,
  quatFromAxisAngle,
  transformPoint,
  vec3,
  type Vec3,
} from "@clockwyrks/structured-3d";
import { PALETTE, TANK } from "./constants";

export class Tank extends Actor {
  readonly turret: MeshComponent;

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 2, height: 0.8, depth: 3 },
        material: { color: PALETTE.hull },
      }),
    );

    this.turret = this.attach(
      new MeshComponent({
        geometry: { kind: "cylinder", radiusTop: 0.6, radiusBottom: 0.6, height: 0.5 },
        material: { color: PALETTE.turret },
      }),
    );
    this.turret.offset.position = vec3(0, 0.65, 0);
  }

  aim(yaw: number): void {
    this.turret.offset.rotation = quatFromAxisAngle(UP, yaw);
  }

  muzzle(): Vec3 {
    return transformPoint(this.turret.worldTransform(), vec3(0, 0, -TANK.barrel));
  }
}
```

`aim` writes the turret's rotation relative to the hull, so a turret aimed
straight ahead keeps facing the hull's forward axis as the tank turns.
`worldTransform()` is the composed placement, and `transformPoint` carries a
point in the turret's own axes out to world units, which is where a shell
spawns.

## Tags

Tags are how a case names things, so take the strings from the case's constants
module rather than writing them inline.

```ts
import { Actor } from "@clockwyrks/structured-3d";
import { TAGS } from "./constants";

export class Brick extends Actor {
  constructor() {
    super();
    this.addTag(TAGS.brick);
  }

  weaken(): void {
    this.addTag(TAGS.cracked);
  }
}
```

```ts
const remaining = this.world.byTag(TAGS.brick).length;
const cracked = this.world
  .byTag(TAGS.brick)
  .filter((actor) => actor.hasTag(TAGS.cracked));
```

## Destroying an actor

`destroy` marks the actor. It stops ticking, drawing, and colliding at once, and
leaves the world at the end of the frame.

```ts
import { Actor, type EndPlayReason } from "@clockwyrks/structured-3d";
import { TAGS } from "./constants";

export class Brick extends Actor {
  hits = 2;

  hit(): void {
    this.hits -= 1;
    if (this.hits <= 0) this.destroy();
  }

  endPlay(reason: EndPlayReason): void {
    if (reason === "destroyed") {
      this.world.audio.play("brick-break", { at: this.transform.position });
    }
  }
}
```

`endPlay` names why the actor is leaving, so cleanup that belongs to being
destroyed is separated from cleanup that belongs to the level closing. Read
`alive` before acting on an actor a handler or a query returned earlier in the
same frame.
