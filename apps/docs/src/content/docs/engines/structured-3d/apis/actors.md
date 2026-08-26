---
title: Actors
---

An actor is a thing in the world. It carries a transform, holds components, and
takes part in every frame in spawn order. A game writes its own actors by
subclassing `Actor`, attaching components in the constructor, and overriding the
lifecycle methods it needs.

## `ActorClass`

```ts
type ActorClass<A extends Actor = Actor> = new () => A;
```

An actor class takes no constructor arguments. The world constructs it and then
applies the spec it was spawned from, so a spec's `configure` callback supplies
whatever the instance needs before it begins play.

## `Transform`

```ts
interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `position` | `(0, 0, 0)` | The actor's position, in world units. |
| `rotation` | identity | The actor's orientation. |
| `scale` | `(1, 1, 1)` | Per-axis scale. |

The transform composes scale, then rotation, then translation, the standard TRS
order. It is mutable in place, and movement is an assignment to
`transform.position` or its fields. A readable rotation is built with
`quatFromAxisAngle`; the identity rotation is `{ x: 0, y: 0, z: 0, w: 1 }`.

`Transform`, `Vec3`, and `Quat` are exported from the package root, together
with the math functions that operate on them. The world's conventions the
transform lives in, right-handed with +Y up, are stated on the
[camera](/engines/structured-3d/apis/camera/) page.

A `Partial<Transform>` on an `ActorSpec` or a `SpawnSpec` fills its absent
fields from these defaults, and each present field replaces the whole value.

## `Actor`

```ts
class Actor {
  readonly world: World;
  readonly id: number;
  readonly transform: Transform;
  readonly components: readonly Component[];
  readonly tags: ReadonlySet<string>;
  readonly alive: boolean;
  tickEnabled: boolean;
  tickWhenPaused: boolean;

  beginPlay(): void;
  tick(dt: number): void;
  endPlay(reason: EndPlayReason): void;

  attach<C extends Component>(component: C): C;
  detach(component: Component): void;
  component<C extends Component>(type: ComponentClass<C>): C | null;
  componentsOf<C extends Component>(type: ComponentClass<C>): readonly C[];

  addTag(tag: string): void;
  removeTag(tag: string): void;
  hasTag(tag: string): boolean;

  destroy(): void;
}
```

| Member | Semantics |
| --- | --- |
| `world` | The world the actor belongs to. Assigned after construction and before `beginPlay`. |
| `id` | Unique within the world, assigned in spawn order from `1`. |
| `transform` | The actor's own position, orientation, and scale, in world units. Mutable in place. |
| `components` | The attached components, in attachment order. |
| `tags` | The tags the actor carries. |
| `alive` | `false` from the moment `destroy` is called. |
| `tickEnabled` | Defaults to `true`. A `false` actor and its components skip their tick. |
| `tickWhenPaused` | Defaults to `false`. A `true` actor ticks with its components while the world is paused. |
| `beginPlay` | Runs once, after the actor has a world. |
| `tick` | Runs once per frame, with the frame's delta in seconds. |
| `endPlay` | Runs once, when the actor is destroyed or when its world closes. |
| `attach` | Attaches the component and returns it. Attaching after `beginPlay` runs the component's `beginPlay` before returning. |
| `detach` | Runs the component's `endPlay("destroyed")` and removes it. |
| `component` | The first attached component that is an instance of `type`, or `null`. |
| `componentsOf` | Every attached component that is an instance of `type`, in attachment order. |
| `addTag` | Adds a tag to the actor. |
| `removeTag` | Removes a tag from the actor. |
| `hasTag` | Whether the actor carries the tag. |
| `destroy` | Marks the actor. `alive` becomes `false` at once, and the actor leaves the world at the end of the frame. |

The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass
overrides only what it needs.

```ts
type EndPlayReason = "destroyed" | "level-closed";
```

`endPlay` receives `"destroyed"` when the actor was destroyed and
`"level-closed"` when the world it belongs to closed.

## Construction

A constructor runs before the actor has a world. It attaches components and sets
defaults; anything that reads the world belongs in `beginPlay`. `world` is
assigned once the constructor has returned and before `beginPlay` runs, so it is
present for every line of code that runs after construction.

## Beginning play

Every actor a level declares exists before any of their `beginPlay` runs, and
those `beginPlay` calls run in spawn order. An actor finds its peers there,
through `world.byTag`, `world.ofType`, or `world.find`, regardless of the order
the level declared them in. The game mode's `beginPlay` runs after every
declared actor has begun play.

`world.spawn` constructs the actor, applies its spec, attaches it to the world,
and runs its `beginPlay` and each component's `beginPlay` before returning. The
actor is live and reachable from `world.actors()` the moment `spawn` returns,
and its first `tick` is the next frame. Spawning emits `actor:spawned`.

## Ticking

Each live actor ticks in spawn order, after every controller has ticked and
before the collision pass runs. Immediately after each actor, that actor's
enabled components tick in attachment order. `dt` is seconds, and every quantity
an actor writes down is per second.

A paused world runs no actor tick. An actor whose `tickWhenPaused` is `true`
ticks anyway, together with its components, which is how a pause menu drives
itself.

## Destruction

`destroy` marks the actor and defers its removal to the end of the frame, so a
tick never observes a half-removed world. `alive` becomes `false` at once: a
destroyed actor stops ticking immediately, stops rendering immediately, and
takes no part in the frame's collision pass.

At the end of the frame each component's `endPlay("destroyed")` runs and then
the actor's, in reverse spawn order across the actors destroyed that frame. The
actor then leaves the world and `actor:destroyed` is emitted.

A destroyed pawn is unpossessed inside `destroy`, at the mark: the seat clears
and `possession:changed` is emitted there, so the pawn's `endPlay` observes
`controller` as `null` and a controller is free to possess another pawn in the
same frame. The game mode's `pawnDied` runs after that `endPlay`, against the
controller that held the pawn at the mark.

Closing a world ends play for every actor it holds: each actor's components' and
then each actor's `endPlay("level-closed")` runs, in reverse spawn order.

## `Pawn`

```ts
class Pawn extends Actor {
  readonly controller: Controller | null;
  possessedBy(controller: Controller): void;
  unpossessed(): void;
}
```

| Member | Semantics |
| --- | --- |
| `controller` | The controller holding this pawn, or `null`. |
| `possessedBy` | Notification that `controller` has taken the pawn. |
| `unpossessed` | Notification that the pawn has been released. |

`possessedBy` and `unpossessed` are notifications; possession itself is the
[controller's](/engines/structured-3d/apis/controllers/) call. The base
implementations do nothing.

A pawn is an actor in every other respect, so it carries a transform, holds
components, and ticks in spawn order alongside everything else in the world.

## Errors

| Condition | Result |
| --- | --- |
| A `beginPlay` throws while the start level is built | `engine.initialize` rejects with the cause |
| A `tick` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |

A throw under `run` leaves the loop alive, so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.

## Exports

`Actor` and `Pawn` are exported as classes from `@test-cabinet/structured-3d`.
`ActorClass`, `Transform`, and `EndPlayReason` are exported as types from the
same entry point.
