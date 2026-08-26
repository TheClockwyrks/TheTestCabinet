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
  ShapeComponent,
} from "@test-cabinet/structured-3d";
import { LAYER, PADDLE, PALETTE, TAGS } from "./constants";

export class Paddle extends Actor {
  readonly body: ShapeComponent;
  readonly collider: ColliderComponent;
  velocityY = 0;

  constructor() {
    super();

    this.body = this.attach(
      new ShapeComponent({
        shape: { kind: "box", size: PADDLE.size },
        color: PALETTE.paddle,
      }),
    );
    this.body.layer = LAYER.scene;

    this.collider = this.attach(
      new ColliderComponent({
        shape: { kind: "box", size: PADDLE.size },
        channel: "paddle",
        responses: { ball: "block" },
      }),
    );

    this.addTag(TAGS.paddle);
  }
}
```

`PADDLE.size` is a `Vec3`, so the drawn box and the collider read the same
extents from one constant. The constructor runs before the actor has a world,
so it confines itself to the actor's own contents. Anything that reads
`this.world` or another actor belongs in `beginPlay`.

## Placing actors and spawning them

A level declares the actors it places, and the world spawns anything that
appears later.

```ts
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { Match } from "./mode";
import { Ball } from "./ball";
import { Paddle } from "./paddle";
import { COURT, TAGS } from "./constants";

export const court: LevelDefinition = {
  mode: Match,
  actors: [
    {
      type: Paddle,
      transform: { position: { x: -COURT.half, y: 0, z: 0 } },
      tags: [TAGS.left],
    },
    { type: Paddle, transform: { position: { x: COURT.half, y: 0, z: 0 } } },
    { type: Ball, transform: { position: { x: 0, y: 0, z: 0 } } },
  ],
};
```

A declared transform is a `Partial<Transform>` over the identity, and each
present field replaces the whole value, so an entry that writes `position`
writes all three of its numbers.

`world.spawn` returns a live actor that has already begun play, so the caller
configures it, stores it, or reads it back immediately.

```ts
const shard = this.world.spawn(Shard, {
  transform: { position: { ...this.transform.position } },
  tags: [TAGS.debris],
  configure: (s) => {
    s.velocity = { x: Math.cos(angle) * 90, y: 0, z: Math.sin(angle) * 90 };
  },
});
```

`configure` runs before the actor begins play, so a field the actor's own
`beginPlay` reads is set through it rather than after `spawn` returns.

## Finding peers in `beginPlay`

Every actor a level declares exists before any `beginPlay` runs, so this is
where an actor looks up the rest of the world. Find by tag when a case fixed the
vocabulary, and by type when the class is the build's own.

```ts
import { Actor } from "@test-cabinet/structured-3d";
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
and cooldown per second, and multiply by the delta.

```ts
import { Actor, type Vec3 } from "@test-cabinet/structured-3d";
import { COURT, BALL_SPEED } from "./constants";

export class Ball extends Actor {
  velocity: Vec3 = { x: BALL_SPEED, y: BALL_SPEED * 0.4, z: 0 };

  tick(dt: number): void {
    this.transform.position.x += this.velocity.x * dt;
    this.transform.position.y += this.velocity.y * dt;
    this.transform.position.z += this.velocity.z * dt;

    if (Math.abs(this.transform.position.y) > COURT.height) {
      this.velocity.y = -this.velocity.y;
      this.world.audio.play("bounce");
    }
  }
}
```

The transform is mutable in place, so movement is an assignment to
`transform.position` or its fields, and a turn is an assignment to
`transform.rotation`, built with `quatFromAxisAngle`. Set `tickEnabled` to
`false` to park an actor and its components without removing them, and
`tickWhenPaused` to `true` for an actor that must keep running while the world
is paused.

## A component with its own tick

Behavior that belongs to a piece rather than to the whole actor goes in a
component. A component extends `Component`, takes whatever constructor arguments
it needs, and reads its actor through `this.actor`.

```ts
import { Component } from "@test-cabinet/structured-3d";

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
    this.offset.position.y = Math.sin(phase) * this.amplitude;
  }
}
```

Writing `offset` moves the component relative to its actor, so a pickup bobs
while its actor stays where the level placed it. Attach it like any other
component:

```ts
import { Actor, MeshComponent } from "@test-cabinet/structured-3d";
import { Bob } from "./bob";
import { meshes } from "./meshes";

export class Pickup extends Actor {
  constructor() {
    super();
    this.attach(new MeshComponent({ mesh: meshes.coin }));
    this.attach(new Bob(0.4, 1.2));
  }
}
```

Components tick in attachment order, immediately after their actor's own tick.
Set `enabled` to `false` on a component to drop its tick, its drawing, and its
collision together.

## Tags

Tags are how a case names things, so take the strings from the case's constants
module rather than writing them inline.

```ts
import { Actor } from "@test-cabinet/structured-3d";
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
import { Actor, type EndPlayReason } from "@test-cabinet/structured-3d";
import { TAGS } from "./constants";

export class Brick extends Actor {
  hits = 2;

  hit(): void {
    this.hits -= 1;
    if (this.hits <= 0) this.destroy();
  }

  endPlay(reason: EndPlayReason): void {
    if (reason === "destroyed") this.world.audio.play("brick-break");
  }
}
```

`endPlay` names why the actor is leaving, so cleanup that belongs to being
destroyed is separated from cleanup that belongs to the level closing. Read
`alive` before acting on an actor a handler or a query returned earlier in the
same frame.
