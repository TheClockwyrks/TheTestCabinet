---
title: Rendering
---

An actor becomes visible by carrying a render component. Attach the component in
the actor's constructor, and the pipeline draws it every frame at the actor's
transform, in world units, lit by the world's lights, under whatever mode the
renderer is in.

The layers and the palette a case fixes belong in one module the whole build
reads:

```ts
// ./constants.ts
export const LAYER = { scene: 0, hud: 1 } as const;

export const PALETTE = {
  ball: "#7fd1ff",
  hud: "#ffffff",
  trail: "#f5d76e",
} as const;
```

## A shape

`ShapeComponent` draws a box, a sphere, or a capsule, centered on the
component's world transform and oriented by its rotation.

```ts
import { Actor, ShapeComponent } from "@test-cabinet/structured-3d";
import { LAYER, PALETTE } from "./constants";

export class Ball extends Actor {
  readonly body: ShapeComponent;

  constructor() {
    super();
    this.body = this.attach(
      new ShapeComponent({
        shape: { kind: "sphere", radius: 0.6 },
        color: PALETTE.ball,
      }),
    );
    this.body.layer = LAYER.scene;
  }
}
```

`color` defaults to `"#ffffff"` and is the surface's base color; a `material`
applied over the primitive multiplies its maps with it. A box's `size` is its
full extent per axis, in world units, and a capsule's axis runs along the
component's local +Y.

## A mesh

A mesh a level needs is loaded in that level's `load`, which the engine awaits
before any actor exists. Hold the loaded handles in a module the actors read:

```ts
// ./meshes.ts
import type { MeshHandle } from "@test-cabinet/structured-3d";

export const meshes: Record<string, MeshHandle> = {};
```

```ts
// ./levels.ts
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { Match } from "./mode";
import { Ship } from "./ship";
import { meshes } from "./meshes";

export const arena: LevelDefinition = {
  mode: Match,
  actors: [{ type: Ship, tags: ["ship"] }],
  async load(api) {
    meshes.ship = await api.assets.loadMesh("models/ship.glb");
  },
};
```

The component then reads the handle as a plain value:

```ts
import { Actor, MeshComponent } from "@test-cabinet/structured-3d";
import { LAYER } from "./constants";
import { meshes } from "./meshes";

export class Ship extends Actor {
  readonly body: MeshComponent;

  constructor() {
    super();
    this.body = this.attach(new MeshComponent({ mesh: meshes.ship }));
    this.body.layer = LAYER.scene;
  }
}
```

The mesh draws with the materials its file carries; a `material` overrides
every surface, and `color` tints the base color. The mesh's local units are
scaled by the world transform's scale, so an authored model is sized to the
game's world units by the actor's `scale`.

An animated mesh is posed by name. `clip` selects a clip from `mesh.clips`,
`clipTime` is the seconds into it the pose is sampled at, and the engine never
advances it, so the pose is game state a tick writes:

```ts
private walking = false;

tick(dt: number): void {
  if (this.walking) this.body.clipTime += dt;
  this.body.clip = this.walking ? "walk" : null;
}
```

The pose is a pure function of `clip` and `clipTime`, which is what lets a
scripted run reproduce it exactly and a check assert it by reading the fields.

## Lighting

Lighting is world content: a light is a component on an actor, so it moves with
its actor and is rebuilt with the world. An ambient light lights everything
evenly, a directional light shines along its component's world −Z, and a point
light shines from its component's world position out to `range`.

```ts
import {
  Actor,
  AmbientLightComponent,
  DirectionalLightComponent,
  quatFromAxisAngle,
} from "@test-cabinet/structured-3d";

export class Sun extends Actor {
  constructor() {
    super();
    this.attach(new AmbientLightComponent({ intensity: 0.3 }));
    this.attach(new DirectionalLightComponent({ intensity: 1 }));
    this.transform.rotation = quatFromAxisAngle(
      { x: 1, y: 0, z: 0 },
      -Math.PI / 3,
    );
  }
}
```

A directional light aims by rotating, exactly as a camera does. A world holding
no enabled light component is lit by the engine's default rig — one ambient and
one directional light — so a scene is visible before the build places its own;
the rig withdraws the moment any light component is enabled. A level that
declares a light actor therefore owns its lighting outright.

## Text

`TextComponent` draws one string as a billboard: a quad at the component's
world position that always faces the camera. `font` defaults to
`"16px sans-serif"`, `fill` to `"#ffffff"`, `align` to `"center"`, and
`baseline` to `"middle"`. The font size is world units of text height, so a
label a few units from the camera wants a fraction of a unit.

```ts
import {
  Actor,
  TextComponent,
  rotateVec3,
  vec3Add,
} from "@test-cabinet/structured-3d";
import { LAYER, PALETTE } from "./constants";

export class Scoreboard extends Actor {
  readonly label: TextComponent;

  constructor() {
    super();
    this.label = this.attach(
      new TextComponent({
        text: "0 - 0",
        font: "0.5px monospace",
        fill: PALETTE.hud,
      }),
    );
    this.label.layer = LAYER.hud;
  }

  tick(): void {
    const scores = this.world.state.players.map((player) => player.score);
    this.label.text = scores.join(" - ");

    const view = this.world.camera.snapshot();
    this.transform.position = vec3Add(
      view.position,
      rotateVec3(view.rotation, { x: 0, y: 1.2, z: -4 }),
    );
  }
}
```

A readout that holds its place while the camera moves rides the camera: the
scoreboard's `tick` places itself a fixed offset in front of the view, in the
camera's own frame. Text draws unlit in every mode except `wireframe`, so a HUD
reads the same under any lighting.

## Choosing layers

`layer` defaults to `0` and orders the whole pipeline. Lower layers draw first,
and **the depth buffer is cleared between layers**, so a later layer draws over
an earlier one however near the earlier one's geometry sits. That is the HUD
idiom: the scene on layer `0`, the billboard text and markers on layer `1`,
never hidden behind the world. Number the layers in one place and give every
component a layer from that table rather than a literal.

Within a layer the depth buffer orders opaque fragments, so components that
occupy the same space resolve by depth rather than by order. The sort — `layer`
ascending, then the owning actor's spawn order, then attachment order — decides
the remaining ties, and it is stable.

## Opacity, tint, and visibility

Every render component carries `layer`, `visible`, and `opacity`. `visible`
defaults to `true`, and `opacity` defaults to `1` and is clamped to `0..1`. A
mesh and a shape carry `color` as the tint, and `null` drops a mesh's tint.

```ts
private invulnerable = 0;

tick(dt: number): void {
  this.invulnerable = Math.max(0, this.invulnerable - dt);

  if (this.invulnerable > 0) {
    this.body.visible = Math.floor(this.invulnerable * 10) % 2 === 0;
    this.body.color = PALETTE.hud;
  } else {
    this.body.visible = true;
    this.body.color = null;
  }
}
```

A component below opacity `1` draws in its layer's transparent pass, after the
opaque components, farthest from the camera first. `visible` takes a component
out of the picture and leaves it ticking. The component's own `enabled` is the
wider switch: a disabled component skips its tick, draws nothing, and takes no
part in collision.

## Following an actor with the camera

Attach a `CameraComponent` to the actor the view should follow, and point the
world's camera at that actor. Each frame the camera adopts the world position,
rotation, and `fovY` of the first enabled `CameraComponent` the target holds.
The ship above becomes the view target by attaching the component and following
itself:

```ts
constructor() {
  super();
  this.body = this.attach(new MeshComponent({ mesh: meshes.ship }));
  this.body.layer = LAYER.scene;

  const cam = this.attach(new CameraComponent({ fovY: Math.PI / 4 }));
  cam.offset.position = { x: 0, y: 2, z: 6 };
}

beginPlay(): void {
  this.world.camera.follow(this);
}
```

The component's `offset` shifts the view relative to its actor, so the chase
camera above sits two units up and six behind — behind is local +Z, since the
actor's forward is −Z and an identity offset looks the way the ship points.
`follow(null)` releases the target and leaves the camera wherever the game
writes it; a released camera is aimed with `world.camera.lookAt(point)`. The
camera has no bounds, so a game that confines its framing writes the
confinement into the code that moves it.

## Drawing directly

A case that measures the drawing itself uses a `DrawComponent`. The engine calls
`draw` in the component's place in the layer order, handing it the scene
context with this frame's camera, lights, and mode already in force, so the
component issues draw calls in world units and inherits the render modes
without implementing them.

```ts
import {
  DrawComponent,
  type DrawApi,
  type Vec3,
} from "@test-cabinet/structured-3d";
import { PALETTE } from "./constants";

export class Trail extends DrawComponent {
  private readonly points: Vec3[] = [];

  tick(): void {
    const at = this.worldTransform();
    this.points.push({ ...at.position });
    if (this.points.length > 48) this.points.shift();
  }

  draw(api: DrawApi): void {
    if (this.points.length < 2) return;
    const color = api.mode === "wireframe" ? PALETTE.hud : PALETTE.trail;
    api.scene.drawLine(this.points, color);
  }
}
```

Every draw call is self-contained — there is no transform stack and no
`save`/`restore` to balance — and a `DrawComponent` never sets the scene
context's camera, lights, or mode; those belong to the pipeline. `api.mode` is
readable for a component that draws differently per mode, as the trail does for
wireframe.

Attach it like any other render component, and give it a layer:

```ts
constructor() {
  super();
  const trail = this.attach(new Trail());
  trail.layer = LAYER.scene;
}
```

The trail shares the scene's layer so the depth buffer orders it against the
geometry around it; a later layer would draw it over everything.

## Switching the mode

The renderer's two switches are reached from the engine and take effect on the
next frame:

```ts
engine.renderer.setMode("wireframe");
engine.renderer.setCollisionOverlay(true);
```

Wireframe shows the geometry a build placed and normals shows which way its
surfaces face, so both are worth looking at while the picture is being built.
