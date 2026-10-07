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
} from "@clockwyrks/structured-2d";
import { LAYER, PADDLE, PALETTE, TAGS } from "./constants";

export class Paddle extends Actor {
  readonly body: ShapeComponent;
  readonly collider: ColliderComponent;
  velocityY = 0;

  constructor() {
    super();

    this.body = this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: PADDLE.width, height: PADDLE.height },
        fill: PALETTE.paddle,
      }),
    );
    this.body.layer = LAYER.actors;

    this.collider = this.attach(
      new ColliderComponent({
        shape: { kind: "rect", width: PADDLE.width, height: PADDLE.height },
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
in `beginPlay`.

## Placing actors and spawning them

A level declares the actors it places, and the world spawns anything that
appears later.

```ts
import type { LevelDefinition } from "@clockwyrks/structured-2d";
import { Match } from "./mode";
import { Ball } from "./ball";
import { Paddle } from "./paddle";
import { FIELD, TAGS } from "./constants";

export const court: LevelDefinition = {
  mode: Match,
  actors: [
    {
      type: Paddle,
      transform: { x: 24, y: FIELD.height / 2 },
      tags: [TAGS.left],
    },
    { type: Paddle, transform: { x: FIELD.width - 24, y: FIELD.height / 2 } },
    { type: Ball, transform: { x: FIELD.width / 2, y: FIELD.height / 2 } },
  ],
};
```

`world.spawn` returns a live actor that has already begun play, so the caller
configures it, stores it, or reads it back immediately.

```ts
const shard = this.world.spawn(Shard, {
  transform: { x: this.transform.x, y: this.transform.y },
  tags: [TAGS.debris],
  configure: (s) => {
    s.velocity = { x: Math.cos(angle) * 90, y: Math.sin(angle) * 90 };
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
import { Actor } from "@clockwyrks/structured-2d";
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
import { Actor } from "@clockwyrks/structured-2d";
import { FIELD, BALL_SPEED } from "./constants";

export class Ball extends Actor {
  velocity = { x: BALL_SPEED, y: BALL_SPEED * 0.4 };

  tick(dt: number): void {
    this.transform.x += this.velocity.x * dt;
    this.transform.y += this.velocity.y * dt;

    if (this.transform.y < 0 || this.transform.y > FIELD.height) {
      this.velocity.y = -this.velocity.y;
      this.world.audio.play("bounce");
    }
  }
}
```

The transform is mutable in place, so movement is an assignment. Set
`tickEnabled` to `false` to park an actor and its components without removing
them, and `tickWhenPaused` to `true` for an actor that must keep running while
the world is paused.

## A component with its own tick

Behavior that belongs to a piece rather than to the whole actor goes in a
component. A component extends `Component`, takes whatever constructor arguments
it needs, and reads its actor through `this.actor`.

```ts
import { Component } from "@clockwyrks/structured-2d";

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
    this.offset.y = Math.sin(phase) * this.amplitude;
  }
}
```

Writing `offset` moves the component relative to its actor, so a pickup bobs
while its actor stays where the level placed it. Attach it like any other
component:

```ts
import { Actor, SpriteComponent } from "@clockwyrks/structured-2d";
import { Bob } from "./bob";
import { textures } from "./textures";

export class Pickup extends Actor {
  constructor() {
    super();
    this.attach(new SpriteComponent({ image: textures.coin }));
    this.attach(new Bob(4, 1.2));
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
import { Actor } from "@clockwyrks/structured-2d";
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
import { Actor, type EndPlayReason } from "@clockwyrks/structured-2d";
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
