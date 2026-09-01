---
title: Models and Animation
---

A model is a glTF file the assets loader decodes into a `Model`: a node tree,
its animation clips, and the names of its nodes. A `ModelComponent` places a
model on an actor the way a `MeshComponent` places a geometry, and one loaded
model backs any number of components, each animating on its own. The per-part
`.glb` files the voxel binaries emit and a whole rig exported as one GLB both
load this way.

## Loading a model in a level's `load`

A level's `load` is awaited before any actor exists, so a model loaded there is
a plain value by the time an actor's constructor reaches for it. Hold the loaded
models in a module the actors read:

```ts
// ./models.ts
import type { Model } from "@test-cabinet/structured-3d";

export const models: Record<string, Model> = {};
```

```ts
// ./levels.ts
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { vec3 } from "@test-cabinet/structured-3d";
import { Match } from "./mode";
import { models } from "./models";
import { Walker } from "./walker";

export const arena: LevelDefinition = {
  mode: Match,
  actors: [
    { type: Walker, transform: { position: vec3(-3, 0, 0) }, tags: ["walker"] },
    { type: Walker, transform: { position: vec3(3, 0, 0) }, tags: ["walker"] },
  ],
  async load(api) {
    models.walker = await api.assets.loadModel("models/walker.glb");
  },
};
```

A model the whole game uses is loaded from the game instance's `initialize`
instead, through `InitApi.assets`, and survives every level transition. Either
way the value that arrives says what it carries: `animations` lists the clips
by name and `nodes` lists every node name in traversal order, so a build checks
what an exporter wrote before it plays a clip or drives a joint.

```ts
const clips = models.walker.animations.map((clip) => clip.name); // ["idle", "walk", "jump"]
const hasTurret = models.walker.nodes.includes("turret");
```

## Placing a model

`ModelComponent` clones the model's scene on construction and the pipeline
places the clone at the component's world transform every frame. A skinned
mesh in the clone keeps its own skeleton, so the two walkers above share one
`Model` and pose independently.

```ts
import { Actor, ModelComponent, vec3 } from "@test-cabinet/structured-3d";
import { LAYER } from "./constants";
import { models } from "./models";

export class Walker extends Actor {
  readonly figure: ModelComponent;

  constructor() {
    super();
    this.figure = this.attach(
      new ModelComponent({ model: models.walker, animation: "idle" }),
    );
    this.figure.offset.scale = vec3(0.1, 0.1, 0.1);
    this.figure.layer = LAYER.actors;
  }
}
```

The component's `offset` is where an exporter's units and axes meet the
world's. A rig exported at ten units to the meter is scaled down through
`offset.scale`, and a rig facing `+Z` is turned to the actor's forward with
`offset.rotation`, so the actor's own transform stays in world units and the
math over it stays plain. An `animation` given at construction plays looping
from the first frame.

## Playing a clip

`play` starts the named clip, looping by default, and `animation()` reports
the clip that is playing. A clip is chosen from the actor's state on every
tick, and the guard on `animation()` keeps a clip already playing from
restarting:

```ts
import { length } from "@test-cabinet/structured-3d";
import type { Vec3 } from "@test-cabinet/structured-3d";

export class Walker extends Actor {
  velocity: Vec3 = { x: 0, y: 0, z: 0 };

  tick(): void {
    const clip = length(this.velocity) > 0.05 ? "walk" : "idle";
    if (this.figure.animation() !== clip) this.figure.play(clip);
  }
}
```

`speed` multiplies the clip's own rate, so a walk cycle authored for one pace
is matched to the pawn's:

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

tick(): void {
  if (this.figure.animation() === "jump") {
    const jump = models.walker.animations.find((clip) => clip.name === "jump");
    if (jump && this.figure.time >= jump.duration) this.figure.play("idle");
    return;
  }
  const clip = length(this.velocity) > 0.05 ? "walk" : "idle";
  if (this.figure.animation() !== clip) this.figure.play(clip);
}
```

`stop` ends the playing clip, after which `animation()` reports `null`. Playing
a name the model lacks throws naming it, so a typo in a clip name surfaces the
first time the tick reaches it. Clips advance by the world's delta, so a paused
world holds every pose and a scripted clock steps every animation exactly as it
steps the simulation.

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
handle is taken once, in the constructor, since the clone exists from
construction, and driven from the tick:

```ts
import {
  Actor,
  ModelComponent,
  quatFromEuler,
  type NodeHandle,
} from "@test-cabinet/structured-3d";
import { models } from "./models";

export class Turret extends Actor {
  readonly figure: ModelComponent;
  private readonly head: NodeHandle | null;
  aim = 0;

  constructor() {
    super();
    this.figure = this.attach(new ModelComponent({ model: models.turret }));
    this.head = this.figure.node("head");
  }

  tick(): void {
    if (this.head) this.head.rotation = quatFromEuler(0, this.aim, 0);
  }
}
```

`node` returns `null` for a name the model lacks, and `model.nodes` lists every
name it accepts, so a build that depends on a joint checks for it once and
carries the handle. The voxel exporter names each part's node after the part,
which is how a rig's head, arm, or wheel is reached by the name the case
declares.

A playing clip poses the nodes its tracks animate when the pipeline advances
the mixer, after every tick, so a write from a tick to one of those nodes is
replaced by the clip's pose for that frame. Drive the nodes a clip leaves alone,
or stop the clip and drive the whole rig from the tick.

## Shadows

Shadows are on when three things agree: the engine is created with `shadows:
true`, a directional or spot light declares `castShadow`, and the meshes
declare which side of a shadow they are on. `castShadow` and `receiveShadow`
on a `MeshComponent` or a `ModelComponent` default to `false`.

```ts
const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  shadows: true,
});
```

```ts
// The walker casts; the ground receives.
this.figure = this.attach(new ModelComponent({ model: models.walker }));
this.figure.castShadow = true;

this.ground = this.attach(
  new MeshComponent({
    geometry: { kind: "box", width: 40, height: 0.2, depth: 40 },
    material: { color: PALETTE.ground },
  }),
);
this.ground.receiveShadow = true;
```

The light is the sun the [rendering page](/engines/structured-3d/usage/rendering/)
attaches to a rig, with `castShadow: true` in its spec. Shadow maps are filtered
soft, and a model's meshes cast and receive as one, so a rig is shadowed by
setting the two flags on the component rather than on each part.
