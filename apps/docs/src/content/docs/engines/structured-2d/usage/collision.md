---
title: Collision
---

A build declares what an actor collides with by attaching a
`ColliderComponent`, and decides what a collision means in its own code. The
engine reports the pairs it finds and the manifold that separates them; the
push-out, the bounce, the pickup, and the score are the game's.

## Attaching a collider

Attach the collider in the actor's constructor, beside whatever draws it. A
collider takes its shape in world units and sits at the component's world
transform, so an actor centered on its transform gives the collider the same
shape its sprite or shape component uses.

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
} from "@test-cabinet/structured-2d";
import { BALL_RADIUS, CHANNELS, PALETTE } from "./constants";

export class Ball extends Actor {
  readonly collider: ColliderComponent;
  velocity = { x: 0, y: 0 };

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "circle", radius: BALL_RADIUS },
        fill: PALETTE.ball,
      }),
    );
    this.collider = this.attach(
      new ColliderComponent({
        shape: { kind: "circle", radius: BALL_RADIUS },
        channel: CHANNELS.ball,
        responses: {
          [CHANNELS.wall]: "block",
          [CHANNELS.paddle]: "block",
          [CHANNELS.goal]: "overlap",
        },
      }),
    );
  }
}
```

Keep the channel names in `./constants`, next to the tags and the action names.
A channel is any string, and one table of them keeps the build and the case
naming the same things.

## Declaring responses

A response is declared once per channel a collider cares about, and a channel
the collider says nothing about is ignored. A pair is resolved from both sides
and takes the stronger of the two answers, so one declaration is enough.

```ts
import { Actor, ColliderComponent } from "@test-cabinet/structured-2d";
import { CHANNELS, WALL_THICKNESS } from "./constants";

export class Wall extends Actor {
  readonly collider: ColliderComponent;

  constructor() {
    super();
    this.collider = this.attach(
      new ColliderComponent({
        shape: { kind: "rect", width: WALL_THICKNESS, height: WALL_THICKNESS },
        channel: CHANNELS.wall,
      }),
    );
  }
}
```

The wall names no responses, and the ball still blocks against it, because the
ball answers `wall` with `"block"`. Writing the mover's table and leaving the
scenery bare keeps the whole filter in one place.

`shape`, `channel`, and `responses` are mutable, so a level sizes a shared actor
class through its spec's `configure`.

```ts
{
  type: Wall,
  transform: { x: FIELD_WIDTH / 2, y: 0 },
  tags: [TAGS.wall],
  configure: (wall) => {
    wall.collider.shape = { kind: "rect", width: FIELD_WIDTH, height: 8 };
  },
}
```

## Responding to a hit

A blocking pair emits `hit` every frame the shapes intersect. Subscribe in
`beginPlay` and drop the subscription in `endPlay`: subscriptions live on the
engine and outlive the world, so a handler left behind would run against a level
that has closed.

`manifold.normal` points from the first collider of the pair toward the second,
and `a` is the actor with the lower `id`. Flip the sign when this actor is `a`.
The result points out of the other shape, which is the direction to push along
and the axis to reflect about.

The handler belongs on the `Ball` above, beside its collider.

```ts
import type { EngineEventMap } from "@test-cabinet/structured-2d";

export class Ball extends Actor {
  private off: (() => void) | null = null;

  beginPlay(): void {
    this.off = this.world.events.on("hit", (event) => this.bounce(event));
  }

  endPlay(): void {
    this.off?.();
    this.off = null;
  }

  private bounce({ a, b, manifold }: EngineEventMap["hit"]): void {
    if (a !== this && b !== this) return;

    const sign = a === this ? -1 : 1;
    const nx = manifold.normal.x * sign;
    const ny = manifold.normal.y * sign;

    this.transform.x += nx * manifold.depth;
    this.transform.y += ny * manifold.depth;

    const into = this.velocity.x * nx + this.velocity.y * ny;
    if (into < 0) {
      this.velocity.x -= 2 * into * nx;
      this.velocity.y -= 2 * into * ny;
    }
  }
}
```

The `into < 0` guard is what makes the response safe to apply every frame. A
pair still overlapping next frame is reported again, and a velocity already
moving away is left alone rather than reflected back in.

A stop is the same push-out with the velocity along the normal removed once
instead of twice.

```ts
this.velocity.x -= into * nx;
this.velocity.y -= into * ny;
```

## Triggers

A trigger is a collider whose pair resolves to `"overlap"`. It reports two
moments, the frame the shapes begin intersecting and the frame they stop, which
is what a goal, a pickup, or a checkpoint wants.

```ts
import { GameMode } from "@test-cabinet/structured-2d";
import type { EngineEventMap } from "@test-cabinet/structured-2d";
import { Ball } from "./ball";
import { CUES, TAGS } from "./constants";

export class Match extends GameMode {
  private off: (() => void) | null = null;

  beginPlay(): void {
    this.addPlayer();
    this.setPhase("playing");
    this.off = this.world.events.on("overlap:begin", (event) =>
      this.scored(event),
    );
  }

  endPlay(): void {
    this.off?.();
    this.off = null;
  }

  private scored({ a, b }: EngineEventMap["overlap:begin"]): void {
    const goal = a.hasTag(TAGS.goal) ? a : b.hasTag(TAGS.goal) ? b : null;
    const ball = a instanceof Ball ? a : b instanceof Ball ? b : null;
    if (!goal || !ball) return;

    this.world.audio.play(CUES.score);
    this.state.players[0].score += 1;
    this.setPhase("over");
  }
}
```

Pick the two sides out of the payload by tag or by class. The pair is reported
with the lower `id` first rather than in the order the actors moved, so a
handler that assumes `a` is the ball reads the wrong actor.

For a standing condition rather than an edge, poll the actor's overlaps from its
tick.

```ts
tick(): void {
  const wet = this.world.collision
    .overlaps(this)
    .some(({ actor }) => actor.hasTag(TAGS.water));

  this.speed = wet ? SWIM_SPEED : RUN_SPEED;
}
```

## Raycasts and shape queries

A query runs on demand from a tick and is answered from the colliders as they
stand. Give it a channel and a response table the same way a collider gets one,
and name the actor itself in `ignore` so a ray leaving an actor skips its own
collider.

```ts
import { Pawn } from "@test-cabinet/structured-2d";
import type { Actor } from "@test-cabinet/structured-2d";
import { CHANNELS, SIGHT_RANGE, TAGS } from "./constants";

export class Guard extends Pawn {
  sees: Actor | null = null;

  tick(): void {
    const origin = { x: this.transform.x, y: this.transform.y };
    const forward = {
      x: Math.cos(this.transform.rotation),
      y: Math.sin(this.transform.rotation),
    };

    const hit = this.world.collision.raycast(origin, forward, SIGHT_RANGE, {
      channel: CHANNELS.vision,
      responses: { [CHANNELS.player]: "block", [CHANNELS.wall]: "block" },
      ignore: [this],
    });

    this.sees = hit && hit.actor.hasTag(TAGS.player) ? hit.actor : null;
  }
}
```

`raycast` returns the nearest hit, so a wall between the guard and the player
answers first and the guard sees nothing. Reach for `raycastAll` where the game
wants every actor along the line, in increasing distance.

A shape query answers what a shape would touch if it were placed somewhere,
which is the blast radius, the melee arc, and the placement test.

```ts
const caught = this.world.collision.query(
  { kind: "circle", radius: BLAST_RADIUS },
  { x: this.transform.x, y: this.transform.y },
  {
    channel: CHANNELS.blast,
    responses: { [CHANNELS.enemy]: "overlap" },
    ignore: [this],
  },
);

for (const { actor } of caught) actor.destroy();
```

## Where collision work belongs

Move in a tick, respond in a handler, judge in the game mode. The pass runs
after every tick and before the game mode ticks, so a handler sees final
positions and the mode sees a world whose collisions have already been
answered. A paused world runs no pass.

A response that writes a transform or a velocity belongs in the handler, and
work that must happen once per pair belongs behind an `overlap:begin`. Anything
that ends a match, changes a score, or opens a level belongs in the mode's
`tick`, from state the handler wrote.

Turn on the [renderer's](/engines/structured-2d/apis/rendering/) collision
overlay with `engine.renderer.setCollisionOverlay(true)` while tuning shapes. It
draws every enabled collider's shape over the finished picture in a color per
response, which is the fastest way to see a shape that sits off its actor.
