# Models and animation

A model is a glTF file the assets loader decodes into a `Model`: a node tree,
its animation clips, and the names of its nodes. A `ModelComponent` places a
model on an actor the way a `MeshComponent` places a geometry, and one loaded
model backs any number of components, each animating on its own.

## `ModelComponent`

```ts
interface NodeHandle {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

class ModelComponent extends RenderComponent {
  constructor(options: { model: Model; animation?: string });
  readonly model: Model;
  castShadow: boolean;
  receiveShadow: boolean;
  time: number;

  play(animation: string, options?: { loop?: boolean; speed?: number }): void;
  stop(): void;
  animation(): string | null;
  node(name: string): NodeHandle | null;
}
```

| Member          | Semantics                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `model`         | The loaded model the component was built from.                                                       |
| `castShadow`    | Defaults to `false`. Whether the model's meshes cast shadows.                                        |
| `receiveShadow` | Defaults to `false`. Whether the model's meshes receive shadows.                                     |
| `time`          | Seconds into the playing animation, `0` when nothing is playing. Writable, so a game seeks.          |
| `play`          | Plays the named clip. `loop` defaults to `true` and `speed` to `1`, a multiplier on the clip's rate. |
| `stop`          | Stops the playing clip.                                                                              |
| `animation`     | The name of the playing clip, or `null`.                                                             |
| `node`          | A live handle onto the named node's local transform, or `null` for a name the model lacks.           |

An `animation` given at construction is played looping from the first frame.

## Placing a model

The component clones `model.scene` on construction and the pipeline places the
clone at the component's world transform every frame. A skinned mesh in the
clone keeps its own skeleton, so two components built from one `Model` pose
independently rather than walking in lockstep.

```ts
import { Actor, ModelComponent, vec3 } from "@clockwyrks/structured-3d";
import { LAYER } from "./constants";
import { assets } from "./assets";

export class Walker extends Actor {
  readonly figure: ModelComponent;

  constructor() {
    super();
    this.figure = this.attach(
      new ModelComponent({ model: assets().walker, animation: "idle" }),
    );
    this.figure.offset.scale = vec3(0.1, 0.1, 0.1);
    this.figure.layer = LAYER.actors;
  }
}
```

The component's `offset` is where an exporter's units and axes meet the world's.
A rig exported at ten units to the meter is scaled down through `offset.scale`,
and a rig facing `+Z` is turned to the actor's forward with `offset.rotation`,
so the actor's own transform stays in world units and the math over it stays
plain.

The model is loaded in the level's `load`, or in the instance's `initialize` for
a model the whole game uses; see `assets.md`.

## Playing a clip

`play` starts the named clip, looping by default, and `animation()` reports the
clip that is playing. A clip is chosen from the actor's state on every tick, and
the guard on `animation()` keeps a clip already playing from restarting:

```ts
import { length } from "@clockwyrks/structured-3d";
import type { Vec3 } from "@clockwyrks/structured-3d";

export class Walker extends Actor {
  velocity: Vec3 = { x: 0, y: 0, z: 0 };

  override tick(): void {
    const clip = length(this.velocity) > 0.05 ? "walk" : "idle";
    if (this.figure.animation() !== clip) this.figure.play(clip);
  }
}
```

`speed` multiplies the clip's own rate, so a walk cycle authored for one pace is
matched to the pawn's:

```ts
this.figure.play("walk", { speed: length(this.velocity) / WALK_SPEED });
```

A clip played with `loop: false` plays once and holds its final pose. `time` is
seconds into the playing clip, and a clip's `duration` is on the
`THREE.AnimationClip` the model lists, so a one-shot is followed by reading the
two against each other:

```ts
jump(): void {
  this.figure.play("jump", { loop: false });
}

override tick(): void {
  if (this.figure.animation() === "jump") {
    const jump = assets().walker.animations.find((c) => c.name === "jump");
    if (jump && this.figure.time >= jump.duration) this.figure.play("idle");
    return;
  }
  const clip = length(this.velocity) > 0.05 ? "walk" : "idle";
  if (this.figure.animation() !== clip) this.figure.play(clip);
}
```

`stop` ends the playing clip, after which `animation()` reports `null`. Playing
a name the model lacks throws naming it, so a typo in a clip name surfaces the
first time the tick reaches it.

Clips advance by the world's delta, so a paused world holds every pose and a
scripted clock steps every animation exactly as it steps the simulation.

## Seeking

`time` is writable, so a game scrubs a clip rather than waiting for it. Writing
`0` restarts the playing clip from its first frame, and writing a later value
jumps to that moment:

```ts
this.figure.play("walk");
this.figure.time = 0.5 * WALK_CYCLE;
```

Two walkers started on the same frame step in unison; offsetting one by half a
cycle is one write to `time`.

## Driving a named node

`node(name)` hands back a live handle onto one node of the clone, with
`position`, `rotation`, and `scale` fields that pose that node directly. The
clone exists from construction, so the handle is taken once in the constructor
and driven from the tick:

```ts
import {
  Actor,
  ModelComponent,
  quatFromEuler,
} from "@clockwyrks/structured-3d";
import type { NodeHandle } from "@clockwyrks/structured-3d";
import { assets } from "./assets";

export class Turret extends Actor {
  readonly figure: ModelComponent;
  private readonly head: NodeHandle | null;
  aim = 0;

  constructor() {
    super();
    this.figure = this.attach(new ModelComponent({ model: assets().turret }));
    this.head = this.figure.node("head");
  }

  override tick(): void {
    if (this.head !== null) this.head.rotation = quatFromEuler(0, this.aim, 0);
  }
}
```

`node` returns `null` for a name the model lacks, and `model.nodes` lists every
name it accepts, so a build that depends on a joint checks for it once and
carries the handle.

A playing clip poses the nodes its tracks animate when the pipeline advances the
mixer, after every tick, so a write from a tick to one of those nodes is
replaced by the clip's pose for that frame. **Drive the nodes a clip leaves
alone, or stop the clip and drive the whole rig from the tick.**

## Shadows

Shadows are on when three things agree: the engine is created with
`shadows: true`, a directional or spot light declares `castShadow` in its spec,
and the meshes declare which side of a shadow they are on.

```ts
this.figure.castShadow = true;
this.ground.receiveShadow = true;
```

A model's meshes cast and receive as one, so a rig is shadowed by setting the
two flags on the component rather than on each part. See `rendering.md`.

## Errors

| Condition                                             | Result                                           |
| ----------------------------------------------------- | ------------------------------------------------ |
| `ModelComponent.play` is given a name the model lacks | `Error` naming the animation                     |
| `ModelComponent.node` is given a name the model lacks | Returns `null`                                   |
| `loadModel` cannot fetch or decode the file           | Rejects with the cause, and emits `asset:failed` |
