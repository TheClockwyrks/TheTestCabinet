---
title: Collision
---

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
the game fixes the set it uses.

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
| `shape` | — | The [`Shape3`](/engines/structured-3d/apis/components/) tested, in world units relative to the component's world transform. |
| `channel` | `"default"` | The channel this collider is on. |
| `responses` | Empty | Maps a channel name to how this collider answers a collider on it. An unlisted channel answers `"ignore"`. |
| `bounds()` | — | The world-axis-aligned `Box3` enclosing the shape at the component's world transform, in world units. |

The shape is positioned and oriented by `worldTransform()`, the actor's
transform composed with the component's `offset`, so one actor carries several
colliders at different offsets. Orientation is part of the test: a box is an
oriented box, and a capsule's axis rotates with the transform. `shape`,
`channel`, and `responses` are mutable, and the pass reads them as they stand
when it runs.

A collider takes part in the pass while it is enabled and its actor is alive. A
disabled component and a destroyed actor are left out.

## Resolving a pair

A pair is evaluated in both directions. Each collider's `responses` are asked
for the other's `channel`, and the pair takes the stronger of the two answers,
ordered `ignore` below `overlap` below `block`. A pair both sides ignore is
never tested.

```ts
new ColliderComponent({
  shape: { kind: "sphere", radius: 8 },
  channel: "ball",
  responses: { wall: "block", goal: "overlap" },
});
```

A collider on `ball` and a collider on `wall` that answers `ball` with
`"overlap"` resolve to `"block"`, because `block` is the stronger of the two.
One side is therefore enough to establish a response, and a game that wants a
pair left alone declares `"ignore"` on both.

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

The pass runs once per [frame](/engines/structured-3d/concepts/frame/), after
every controller, actor, and component has ticked and after the frame's timers
have fired, and before the game mode ticks. A pair produced by this frame's
movement is therefore reported in this frame, and the game mode decides the
match from a settled world. A paused world runs no pass.

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
pair reports the same way whichever side moved. `manifold.normal` points from
`colliders[0]` toward `colliders[1]`.

The [renderer's](/engines/structured-3d/apis/rendering/) collision overlay
draws every enabled collider's shape as wireframe outlines over the finished
picture, in a color per response.

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
units. `query` places `shape` at `at` with identity orientation and unit
scale; an oriented test is run by giving an actor a collider.

A pointer pick composes the
[camera's picking ray](/engines/structured-3d/apis/camera/) with the ray
query:

```ts
const ray = world.camera.ray(reader.pointer());
const hit = world.collision.raycast(ray.origin, ray.direction, 200, {
  channel: "pick",
});
```

`QueryOptions` puts the query on a channel and gives it a response map, so the
query is filtered by the same both-directions rule a pair of colliders is. A
collider the resolution leaves at `"ignore"` is left out of the result, and so
is every collider owned by an actor `ignore` names.

A query is answered from the colliders as they stand when it is called and
returns its result to the caller. The three collision events belong to the
frame's pass.

## Errors

| Condition | Result |
| --- | --- |
| `engine.world`, and so `world.collision`, reached before `engine.initialize` resolves | `Error` naming the ordering |
| A `hit`, `overlap:begin`, or `overlap:end` handler throws | The error reaches the console and the remaining handlers still run |

## Exports

`ColliderComponent` is exported as a class from `@test-cabinet/structured-3d`.
`CollisionResponse`, `ColliderOptions`, `Shape3`, `Manifold`, `Overlap`,
`Hit`, `QueryOptions`, and `CollisionWorld` are exported as types.
