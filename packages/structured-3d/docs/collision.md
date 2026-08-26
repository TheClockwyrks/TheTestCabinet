# Collision

Detection belongs to the engine and response belongs to the game. The engine
finds the pairs, reports them with the manifold that separates them, and moves
nothing. A game declares what an actor collides with by attaching a
`ColliderComponent`, and reads the result from the collision events and from
`world.collision`.

## Responses and channels

```ts
type CollisionResponse = "ignore" | "overlap" | "block";
```

| Response | Meaning |
| --- | --- |
| `ignore` | The pair is never tested. |
| `overlap` | The pair is reported when its shapes begin intersecting and when they stop. |
| `block` | The pair is reported with a manifold on every frame its shapes intersect. |

A channel is a name a collider is on and a name every other collider answers
for. The channel vocabulary belongs to the game: a channel is any string, and
the game fixes the set it uses in one constants module, next to its tags and
action names.

## `ColliderComponent`

```ts
interface ColliderOptions {
  shape: Shape3;
  channel?: string;
  responses?: Readonly<Record<string, CollisionResponse>>;
}

class ColliderComponent extends Component {
  constructor(options: ColliderOptions);
  shape: Shape3;
  channel: string;
  responses: Record<string, CollisionResponse>;
  bounds(): Box3;
}
```

| Member | Default | Semantics |
| --- | --- | --- |
| `shape` | — | The `Shape3` tested, in world units relative to the component's world transform. See `components.md`. |
| `channel` | `"default"` | The channel this collider is on. |
| `responses` | Empty | Maps a channel name to how this collider answers a collider on it. An unlisted channel answers `"ignore"`. |
| `bounds()` | — | The world-axis-aligned `Box3` enclosing the shape at the component's world transform, in world units. |

The shape is positioned **and oriented** by `worldTransform()`, the actor's
transform composed with the component's `offset`, so one actor carries several
colliders at different offsets. Orientation is part of the test: a box is an
oriented box, and a capsule's axis rotates with the transform. `shape`,
`channel`, and `responses` are mutable, and the pass reads them as they stand
when it runs — which is how a level sizes a shared actor class through its
spec's `configure`.

A collider takes part in the pass while it is enabled and its actor is alive. A
disabled component and a destroyed actor are left out.

```ts
export class Ball extends Actor {
  readonly collider: ColliderComponent;
  velocity: Vec3 = { x: 0, y: 0, z: 0 };

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

## Resolving a pair

A pair is evaluated in both directions. Each collider's `responses` are asked
for the other's `channel`, and the pair takes the **stronger** of the two
answers, ordered `ignore` below `overlap` below `block`. A pair both sides
ignore is never tested.

One side is therefore enough to establish a response: the wall above names no
responses and the ball still blocks against it, because the ball answers `wall`
with `"block"`. Writing the mover's table and leaving the scenery bare keeps the
whole filter in one place, and a game that wants a pair left alone declares
`"ignore"` on both.

## The manifold

```ts
interface Manifold {
  normal: Vec3;
  depth: number;
  point: Vec3;
}
```

| Field | Meaning |
| --- | --- |
| `normal` | The unit direction separating the pair, pointing from the first collider of the pair toward the second. |
| `depth` | How far the two shapes penetrate along `normal`, in world units. |
| `point` | A point on the shared boundary. |

The manifold is oriented by the reported order of the pair, so the first
collider is moved out of the second along `-normal` and the second out of the
first along `+normal`. Multiplying `normal` by `depth` gives the smallest
translation that separates them.

## The collision pass

The pass runs once per frame, after every controller, actor, and component has
ticked and after the frame's timers have fired, and before the game mode ticks.
A pair produced by this frame's movement is therefore reported in this frame,
and the game mode decides the match from a settled world. A paused world runs no
pass.

The pass emits three events on the engine's broadcaster, reachable as
`world.events`:

```ts
"overlap:begin": {
  a: Actor;
  b: Actor;
  colliders: [ColliderComponent, ColliderComponent];
};

"overlap:end": {
  a: Actor;
  b: Actor;
  colliders: [ColliderComponent, ColliderComponent];
};

"hit": {
  a: Actor;
  b: Actor;
  colliders: [ColliderComponent, ColliderComponent];
  manifold: Manifold;
};
```

| Event | Emitted |
| --- | --- |
| `overlap:begin` | On the first frame the pass finds an overlapping pair. |
| `overlap:end` | On the first frame the pass stops finding it, and when either actor is destroyed or the world closes. |
| `hit` | On every frame the pass finds a blocking pair, so a game applies its response each frame the pair persists. |

`a` is the actor with the lower `id` and `colliders` is in the same order, so a
pair reports the same way whichever side moved — a handler that assumes `a` is
the ball reads the wrong actor. `manifold.normal` points from `colliders[0]`
toward `colliders[1]`.

## Responding to a hit

Subscribe in `beginPlay` and drop the subscription in `endPlay`: subscriptions
live on the engine and outlive the world, so a handler left behind would run
against a level that has closed. Flip the normal's sign when this actor is `a`,
and the result points out of the other shape — the direction to push along and
the axis to reflect about.

```ts
import { vec3Add, vec3Dot, vec3Scale, vec3Sub } from "@test-cabinet/structured-3d";
import type { EngineEventMap } from "@test-cabinet/structured-3d";

export class Ball extends Actor {
  private off: (() => void) | null = null;

  override beginPlay(): void {
    this.off = this.world.events.on("hit", (event) => this.bounce(event));
  }

  override endPlay(): void {
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

The `into < 0` guard is what makes the response safe to apply every frame: a
pair still overlapping next frame is reported again, and a velocity already
moving away is left alone rather than reflected back in. A stop is the same
push-out with the velocity along the normal removed once instead of twice:

```ts
this.velocity = vec3Sub(this.velocity, vec3Scale(n, into));
```

## Triggers

A trigger is a collider whose pair resolves to `"overlap"`. It reports two
moments, the frame the shapes begin intersecting and the frame they stop, which
is what a goal, a pickup, or a checkpoint wants. Pick the two sides out of the
payload by tag or by class:

```ts
private scored({ a, b }: EngineEventMap["overlap:begin"]): void {
  const goal = a.hasTag(TAGS.goal) ? a : b.hasTag(TAGS.goal) ? b : null;
  const ball = a instanceof Ball ? a : b instanceof Ball ? b : null;
  if (!goal || !ball) return;

  this.world.audio.play(CUES.score);
  this.state.players[0].score += 1;
}
```

For a standing condition rather than an edge, poll the actor's overlaps from its
tick:

```ts
override tick(): void {
  const wet = this.world.collision
    .overlaps(this)
    .some(({ actor }) => actor.hasTag(TAGS.water));

  this.speed = wet ? SWIM_SPEED : RUN_SPEED;
}
```

## Queries

```ts
interface Overlap {
  actor: Actor;
  collider: ColliderComponent;
}

interface Hit {
  actor: Actor;
  collider: ColliderComponent;
  point: Vec3;
  normal: Vec3;
  distance: number;
}

interface QueryOptions {
  channel?: string;
  responses?: Readonly<Record<string, CollisionResponse>>;
  ignore?: readonly Actor[];
}

interface CollisionWorld {
  overlaps(actor: Actor): readonly Overlap[];
  query(shape: Shape3, at: Vec3, options?: QueryOptions): readonly Overlap[];
  raycast(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): Hit | null;
  raycastAll(
    origin: Vec3,
    direction: Vec3,
    distance: number,
    options?: QueryOptions,
  ): readonly Hit[];
}
```

| Member | Result |
| --- | --- |
| `overlaps(actor)` | The colliders currently intersecting one of `actor`'s, each with the actor that owns it. |
| `query(shape, at, options)` | The colliders `shape` intersects when it is placed at `at`. |
| `raycast(origin, direction, distance, options)` | The nearest hit along the ray, or `null`. |
| `raycastAll(origin, direction, distance, options)` | Every hit along the ray, in increasing `distance`. |

| `Hit` field | Meaning |
| --- | --- |
| `actor` | The actor the ray met. |
| `collider` | The collider on it the ray met. |
| `point` | Where the ray meets the collider, in world units. |
| `normal` | The unit surface normal at `point`. |
| `distance` | How far along the ray `point` lies, from `origin`. |

`direction` is a unit vector and `distance` bounds the ray's length, in world
units. `QueryOptions` puts the query on a channel and gives it a response map,
so the query is filtered by the same both-directions rule a pair of colliders
is. A collider the resolution leaves at `"ignore"` is left out of the result,
and so is every collider owned by an actor `ignore` names — name the actor
itself so a ray leaving it skips its own collider.

```ts
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
```

`raycast` returns the nearest hit, so a wall between the guard and the player
answers first and the guard sees nothing. Reach for `raycastAll` where the game
wants every actor along the line.

A pointer pick is the same query fed by the camera. The pointer is 2D and
logical; `world.camera.ray` turns it into a world-space ray:

```ts
const ray = this.world.camera.ray(this.input.pointer());
const hit = this.world.collision.raycast(ray.origin, ray.direction, PICK_RANGE, {
  channel: CHANNELS.pick,
});
```

A shape query answers what a shape would touch if it were placed somewhere,
which is the blast radius, the melee arc, and the placement test. It places
`shape` at `at` with identity orientation and unit scale; an oriented test is
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

A query is answered from the colliders as they stand when it is called and
returns its result to the caller. The three collision events belong to the
frame's pass.

## Where collision work belongs

Move in a tick, respond in a handler, judge in the game mode. The pass runs
after every tick and before the game mode ticks, so a handler sees final
positions and the mode sees a world whose collisions have already been answered.
A response that writes a transform or a velocity belongs in the handler, work
that must happen once per pair belongs behind an `overlap:begin`, and anything
that ends a match, changes a score, or opens a level belongs in the mode's
`tick`, from state the handler wrote.

Turn on the renderer's collision overlay with
`engine.renderer.setCollisionOverlay(true)` while tuning shapes. It draws every
enabled collider's shape as outlines over the finished picture in a color per
response — `#ff4040` for a blocker, `#40ff40` for an overlapper, `#808080` for a
collider that declares neither — which is the fastest way to see a shape that
sits off its actor.

## Errors

| Condition | Result |
| --- | --- |
| `engine.world`, and so `world.collision`, reached before `engine.initialize` resolves | `Error` naming the ordering |
| A `hit`, `overlap:begin`, or `overlap:end` handler throws | The error reaches the console and the remaining handlers still run |
