# Actors

An actor is a thing in the world. It carries a transform, holds components, and
takes part in every frame in spawn order. A game writes its own actors by
subclassing `Actor`, attaching components in the constructor, and overriding the
lifecycle methods it needs.

## `Transform`

```ts
interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `x` | `0` | Position along the world's horizontal axis, in world units. |
| `y` | `0` | Position along the world's vertical axis, in world units. |
| `rotation` | `0` | Radians, clockwise, with `0` pointing along `+x`. |
| `scaleX` | `1` | Scale along the horizontal axis. |
| `scaleY` | `1` | Scale along the vertical axis. |

A `Partial<Transform>` on an `ActorSpec` or a `SpawnSpec` fills its absent
fields from these defaults.

## `Actor`

```ts
type ActorClass<A extends Actor = Actor> = new () => A;

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
| `transform` | The actor's own position, rotation, and scale, in world units. Mutable in place. |
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
| `addTag` / `removeTag` / `hasTag` | The tag calls. |
| `destroy` | Marks the actor. `alive` becomes `false` at once, and the actor leaves the world at the end of the frame. |

The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass
overrides only what it needs.

```ts
type EndPlayReason = "destroyed" | "level-closed";
```

`endPlay` receives `"destroyed"` when the actor was destroyed and
`"level-closed"` when the world it belongs to closed.

## Construction

An actor class takes no constructor arguments: the world constructs it and then
applies the spec it was spawned from, so a spec's `configure` callback supplies
whatever the instance needs before it begins play. A constructor runs before the
actor has a world — it attaches components, holds a field for each one, and sets
defaults; anything that reads `this.world` or another actor belongs in
`beginPlay`.

```ts
import { Actor, ColliderComponent, ShapeComponent } from "@test-cabinet/structured-2d";
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

`attach` returns the component it was given, so the field is assigned and
attached in one statement.

## Beginning play

Every actor a level declares exists before any of their `beginPlay` runs, and
those `beginPlay` calls run in spawn order. An actor finds its peers there,
through `world.byTag`, `world.ofType`, or `world.find`, regardless of the order
the level declared them in. The game mode's `beginPlay` runs after every
declared actor has begun play.

```ts
export class Goal extends Actor {
  private ball: Ball | null = null;
  private posts: readonly Actor[] = [];

  override beginPlay(): void {
    this.ball = this.world.find(Ball);
    this.posts = this.world.byTag(TAGS.post);
  }
}
```

`world.spawn` constructs the actor, applies its spec, attaches it to the world,
and runs its `beginPlay` and each component's `beginPlay` before returning. The
actor is live and reachable from `world.actors()` the moment `spawn` returns,
and its first `tick` is the next frame. Spawning emits `actor:spawned`.

## Ticking

Each live actor ticks in spawn order, after every controller has ticked and
before the collision pass runs. Immediately after each actor, that actor's
enabled components tick in attachment order. `dt` is seconds, and every quantity
an actor writes down is per second. The transform is mutable in place, so
movement is an assignment:

```ts
export class Ball extends Actor {
  velocity = { x: BALL_SPEED, y: BALL_SPEED * 0.4 };

  override tick(dt: number): void {
    this.transform.x += this.velocity.x * dt;
    this.transform.y += this.velocity.y * dt;

    if (this.transform.y < 0 || this.transform.y > FIELD.height) {
      this.velocity.y = -this.velocity.y;
      this.world.audio.play("bounce");
    }
  }
}
```

Set `tickEnabled` to `false` to park an actor and its components without
removing them, and `tickWhenPaused` to `true` for an actor that must keep
running while the world is paused, such as a pause menu.

## Tags

Tags are how a build names things across modules, so take the strings from one
constants module rather than writing them inline. `byTag` is also the lookup the
debug overlay's sources and a debug surface most naturally count over, so a
stable tag vocabulary pays for itself.

```ts
const remaining = this.world.byTag(TAGS.brick).length;
const cracked = this.world
  .byTag(TAGS.brick)
  .filter((actor) => actor.hasTag(TAGS.cracked));
```

## Destruction

`destroy` marks the actor and defers its removal to the end of the frame, so a
tick never observes a half-removed world. `alive` becomes `false` at once: a
destroyed actor stops ticking immediately, stops rendering immediately, and
takes no part in the frame's collision pass. Read `alive` before acting on an
actor a handler or a query returned earlier in the same frame.

At the end of the frame each component's `endPlay("destroyed")` runs and then
the actor's, in reverse spawn order across the actors destroyed that frame. The
actor then leaves the world and `actor:destroyed` is emitted. A destroyed pawn
is unpossessed first, and the game mode's `pawnDied` runs after the pawn's
`endPlay`.

```ts
export class Brick extends Actor {
  hits = 2;

  hit(): void {
    this.hits -= 1;
    if (this.hits <= 0) this.destroy();
  }

  override endPlay(reason: EndPlayReason): void {
    if (reason === "destroyed") this.world.audio.play("brick-break");
  }
}
```

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
controller's call, and the base implementations do nothing. A pawn is an actor
in every other respect: it carries a transform, holds components, and ticks in
spawn order alongside everything else in the world. See `controllers.md` for
what possession buys.

## Errors

| Condition | Result |
| --- | --- |
| A `beginPlay` throws while the start level is built | `engine.initialize` rejects with the cause |
| A `tick` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
