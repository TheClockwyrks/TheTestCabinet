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
shape its mesh uses.

```ts
import {
  Actor,
  ColliderComponent,
  MeshComponent,
  type Vec3,
} from "@clockwyrks/structured-3d";
import { BALL_RADIUS, CHANNELS, PALETTE } from "./constants";

export class Ball extends Actor {
  readonly collider: ColliderComponent;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "sphere", radius: BALL_RADIUS },
        material: { color: PALETTE.ball },
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

A box and a capsule are oriented by the transform's rotation, and a sphere
ignores it. A capsule stands along the component's local `Y`, its `height` the
cylindrical part between the two caps, which is the shape for a pawn that
walks: it slides over a step and stands on a slope without catching an edge.

## Declaring responses

A response is declared once per channel a collider cares about, and a channel
the collider says nothing about is ignored. A pair is resolved from both sides
and takes the stronger of the two answers, so one declaration is enough.

```ts
import { Actor, ColliderComponent } from "@clockwyrks/structured-3d";
import { CHANNELS, WALL_THICKNESS } from "./constants";

export class Wall extends Actor {
  readonly collider: ColliderComponent;

  constructor() {
    super();
    this.collider = this.attach(
      new ColliderComponent({
        shape: {
          kind: "box",
          width: WALL_THICKNESS,
          height: WALL_THICKNESS,
          depth: WALL_THICKNESS,
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
  transform: { position: vec3(0, WALL_HEIGHT / 2, -FIELD_DEPTH / 2) },
  tags: [TAGS.wall],
  configure: (wall: Wall) => {
    wall.collider.shape = {
      kind: "box",
      width: FIELD_WIDTH,
      height: WALL_HEIGHT,
      depth: 0.5,
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
and the axis to reflect about, and the vector helpers keep the three components
together.

The handler belongs on the `Ball` above, beside its collider.

```ts
import { add, dot, scale, sub } from "@clockwyrks/structured-3d";
import type { EngineEventMap } from "@clockwyrks/structured-3d";

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

    const n = scale(manifold.normal, a === this ? -1 : 1);
    this.transform.position = add(
      this.transform.position,
      scale(n, manifold.depth),
    );

    const into = dot(this.velocity, n);
    if (into < 0) this.velocity = sub(this.velocity, scale(n, 2 * into));
  }
}
```

The `into < 0` guard is what makes the response safe to apply every frame. A
pair still overlapping next frame is reported again, and a velocity already
moving away is left alone rather than reflected back in.

A stop is the same push-out with the velocity along the normal removed once
instead of twice.

```ts
this.velocity = sub(this.velocity, scale(n, into));
```

`manifold.point` is a point on the shared boundary, which is where a spark, a
decal, or a positional cue belongs.

## Triggers

A trigger is a collider whose pair resolves to `"overlap"`. It reports two
moments, the frame the shapes begin intersecting and the frame they stop, which
is what a goal, a pickup, or a checkpoint wants.

```ts
import { GameMode } from "@clockwyrks/structured-3d";
import type { EngineEventMap } from "@clockwyrks/structured-3d";
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

    this.world.audio.play(CUES.score, { at: ball.transform.position });
    this.state.players[0].score += 1;
    this.setPhase("over");
  }
}
```

Pick the two sides out of the payload by tag or by class. The pair is reported
with the lower `id` first rather than in the order the actors moved, so a
handler tests both sides for the ball.

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
collider. An actor's forward is `FORWARD` turned by its rotation.

```ts
import {
  FORWARD,
  Pawn,
  add,
  quatRotate,
  vec3,
} from "@clockwyrks/structured-3d";
import type { Actor } from "@clockwyrks/structured-3d";
import { CHANNELS, EYE_HEIGHT, SIGHT_RANGE, TAGS } from "./constants";

export class Guard extends Pawn {
  sees: Actor | null = null;

  tick(): void {
    const eye = add(this.transform.position, vec3(0, EYE_HEIGHT, 0));
    const forward = quatRotate(this.transform.rotation, FORWARD);

    const hit = this.world.collision.raycast(eye, forward, SIGHT_RANGE, {
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
wants every actor along the line, in increasing distance. A hit carries the
`point` where the ray met the collider and the surface `normal` there, which is
where a bullet hole is placed and how a grenade rebounds.

A pointer pick is a raycast along the ray the camera hands back for the
pointer's logical point. The controller reads the pointer, asks the camera for
the ray, and casts it:

```ts
import { PlayerController } from "@clockwyrks/structured-3d";
import type { Actor } from "@clockwyrks/structured-3d";
import { CHANNELS, PICK_RANGE } from "./constants";

export class CursorController extends PlayerController {
  hovered: Actor | null = null;

  tick(): void {
    const ray = this.world.camera.logicalToRay(this.input.pointer());
    const hit = this.world.collision.raycast(
      ray.origin,
      ray.direction,
      PICK_RANGE,
      {
        channel: CHANNELS.cursor,
        responses: { [CHANNELS.piece]: "overlap" },
      },
    );

    this.hovered = hit ? hit.actor : null;
  }
}
```

`logicalToRay` answers from the camera as it stands at the call, so a pick
from a controller's tick uses the camera the previous frame drew through, and a
following camera moves before the next frame draws. The nearest collider on a
channel the query answers is the hit, and `hit.point` is where in the world
the pointer landed.

A shape query answers what a shape would touch if it were placed somewhere,
which is the blast radius, the melee arc, and the placement test. The shape is
placed at `at` and turned by the rotation, which `QUAT_IDENTITY` leaves
unrotated.

```ts
const caught = this.world.collision.query(
  { kind: "sphere", radius: BLAST_RADIUS },
  this.transform.position,
  QUAT_IDENTITY,
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

Turn on the renderer's collision overlay with
`engine.renderer.setCollisionOverlay(true)` while tuning shapes. It
draws every enabled collider's shape as a wireframe over the finished world
pass, with depth testing off and in a color per response, which is the fastest
way to see a shape that sits off its actor or a capsule standing on the wrong
axis.
