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
transform, positioned and oriented by it — a box is an oriented box, and a
capsule's axis rotates with the actor — so an actor centered on its transform
gives the collider the same shape its render component uses.

```ts
import {
  Actor,
  ColliderComponent,
  ShapeComponent,
} from "@test-cabinet/structured-3d";
import { BALL_RADIUS, CHANNELS, PALETTE } from "./constants";

export class Ball extends Actor {
  readonly collider: ColliderComponent;
  velocity = { x: 0, y: 0, z: 0 };

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "sphere", radius: BALL_RADIUS },
        color: PALETTE.ball,
      }),
    );
    this.collider = this.attach(
      new ColliderComponent({
        shape: { kind: "sphere", radius: BALL_RADIUS },
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
import { Actor, ColliderComponent } from "@test-cabinet/structured-3d";
import { CHANNELS, WALL_THICKNESS } from "./constants";

export class Wall extends Actor {
  readonly collider: ColliderComponent;

  constructor() {
    super();
    this.collider = this.attach(
      new ColliderComponent({
        shape: {
          kind: "box",
          size: { x: WALL_THICKNESS, y: WALL_THICKNESS, z: WALL_THICKNESS },
        },
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
  transform: { position: { x: 0, y: ARENA.height, z: 0 } },
  tags: [TAGS.wall],
  configure: (wall) => {
    wall.collider.shape = {
      kind: "box",
      size: { x: ARENA.width, y: 1, z: ARENA.depth },
    };
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
import {
  vec3Add,
  vec3Dot,
  vec3Scale,
  vec3Sub,
} from "@test-cabinet/structured-3d";
import type { EngineEventMap } from "@test-cabinet/structured-3d";

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

    const n = vec3Scale(manifold.normal, a === this ? -1 : 1);

    this.transform.position = vec3Add(
      this.transform.position,
      vec3Scale(n, manifold.depth),
    );

    const into = vec3Dot(this.velocity, n);
    if (into < 0) {
      this.velocity = vec3Sub(this.velocity, vec3Scale(n, 2 * into));
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
this.velocity = vec3Sub(this.velocity, vec3Scale(n, into));
```

## Triggers

A trigger is a collider whose pair resolves to `"overlap"`. It reports two
moments, the frame the shapes begin intersecting and the frame they stop, which
is what a goal, a pickup, or a checkpoint wants.

```ts
import { GameMode } from "@test-cabinet/structured-3d";
import type { EngineEventMap } from "@test-cabinet/structured-3d";
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
import { Pawn, rotateVec3 } from "@test-cabinet/structured-3d";
import type { Actor } from "@test-cabinet/structured-3d";
import { CHANNELS, SIGHT_RANGE, TAGS } from "./constants";

export class Guard extends Pawn {
  sees: Actor | null = null;

  tick(): void {
    const forward = rotateVec3(this.transform.rotation, { x: 0, y: 0, z: -1 });

    const hit = this.world.collision.raycast(
      this.transform.position,
      forward,
      SIGHT_RANGE,
      {
        channel: CHANNELS.vision,
        responses: { [CHANNELS.player]: "block", [CHANNELS.wall]: "block" },
        ignore: [this],
      },
    );

    this.sees = hit && hit.actor.hasTag(TAGS.player) ? hit.actor : null;
  }
}
```

`raycast` returns the nearest hit, so a wall between the guard and the player
answers first and the guard sees nothing. Reach for `raycastAll` where the game
wants every actor along the line, in increasing distance.

A pointer pick is the same query fed by the camera. The pointer is 2D and
logical; `world.camera.ray` turns it into a world-space ray, and the raycast
answers what it touched first.

```ts
import { PlayerController } from "@test-cabinet/structured-3d";
import { CHANNELS, PICK_RANGE } from "./constants";

export class Selector extends PlayerController {
  tick(): void {
    if (!this.input.pointerPressed()) return;

    const ray = this.world.camera.ray(this.input.pointer());
    const hit = this.world.collision.raycast(
      ray.origin,
      ray.direction,
      PICK_RANGE,
      { channel: CHANNELS.pick },
    );

    hit?.actor.addTag("selected");
  }
}
```

A shape query answers what a shape would touch if it were placed somewhere,
which is the blast radius, the melee arc, and the placement test. The query
places its shape with identity orientation and unit scale; an oriented test is
run by giving an actor a collider.

```ts
const caught = this.world.collision.query(
  { kind: "sphere", radius: BLAST_RADIUS },
  this.transform.position,
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

Turn on the [renderer's](/engines/structured-3d/apis/rendering/) collision
overlay with `engine.renderer.setCollisionOverlay(true)` while tuning shapes. It
draws every enabled collider's shape as wireframe outlines over the finished
picture in a color per response, which is the fastest way to see a shape that
sits off its actor.
