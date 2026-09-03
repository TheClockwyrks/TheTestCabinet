---
title: Rendering
---

An actor becomes visible by carrying a render component. Attach the component in
the actor's constructor, and the pipeline draws it every frame at the actor's
transform: a world-space component in world units through the camera, and a
screen-space component in logical units on the screen layer, under whatever
mode the renderer is in.

The layers and the palette a case fixes belong in one module the whole build
reads:

```ts
// ./constants.ts
export const LAYER = { field: 0, actors: 10, effects: 20, hud: 30 } as const;

export const PALETTE = {
  ball: "#7fd1ff",
  ship: "#d9d9d9",
  exhaust: "#f5d76e",
  hud: "#ffffff",
} as const;
```

## A mesh

`MeshComponent` draws one of the built-in geometries, centered on the
component's transform, with a material declared as a spec.

```ts
import { Actor, MeshComponent } from "@test-cabinet/structured-3d";
import { LAYER, PALETTE } from "./constants";

export class Ball extends Actor {
  readonly body: MeshComponent;

  constructor() {
    super();
    this.body = this.attach(
      new MeshComponent({
        geometry: { kind: "sphere", radius: 0.5 },
        material: { color: PALETTE.ball, roughness: 0.4 },
      }),
    );
    this.body.layer = LAYER.actors;
  }
}
```

Every dimension of a geometry is in world units, and a box, a cylinder, and a
capsule are oriented by the component's transform. The material defaults to
`kind: "standard"` in white with `roughness 1` and `metalness 0`, and a
`standard` or `lambert` material takes its shading from the scene's lights,
so a level that draws with either also carries a light. A `basic` material
draws its color as given, which is the choice for a marker or a glow that owes
nothing to the lighting.

`geometry` and `material` are read on assignment, so a change is a new value
written to the field. Spread the current spec into the new one to change one
field:

```ts
tick(): void {
  const hot = this.world.state.phase === "playing";
  const emissive = hot ? PALETTE.exhaust : "#000000";
  if (this.body.material.emissive !== emissive) {
    this.body.material = { ...this.body.material, emissive };
  }
}
```

## A textured mesh

A texture a level needs is loaded in that level's `load`, which the engine
awaits before any actor exists. Hold the loaded textures in a module the actors
read:

```ts
// ./textures.ts
import type * as THREE from "three";

export const textures: Record<string, THREE.Texture> = {};
```

```ts
// ./levels.ts
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { vec3 } from "@test-cabinet/structured-3d";
import { Match } from "./mode";
import { Ship } from "./ship";
import { textures } from "./textures";

export const arena: LevelDefinition = {
  mode: Match,
  actors: [{ type: Ship, transform: { position: vec3(0, 1, 0) }, tags: ["ship"] }],
  async load(api) {
    textures.hull = await api.assets.loadTexture("hull.png");
  },
};
```

The component then reads the texture as a plain value through the material's
`map`:

```ts
import { Actor, MeshComponent } from "@test-cabinet/structured-3d";
import { LAYER } from "./constants";
import { textures } from "./textures";

export class Ship extends Actor {
  readonly hull: MeshComponent;

  constructor() {
    super();
    this.hull = this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 2, height: 0.6, depth: 3 },
        material: { map: textures.hull },
      }),
    );
    this.hull.layer = LAYER.actors;
  }
}
```

`map` is sampled as the base color under the texture's own filtering, and
`color` multiplies it, so the default white leaves the image as loaded. A
`plane` lies in the component's local `XY` plane facing `+Z`, which makes it the
geometry for a decal or a flat card, and `billboard: true` turns any mesh to
face the camera each frame while it keeps its position and scale.

## Lights

A light is a `LightComponent` on an actor, and a level's lighting rig is an
actor that carries them. An ambient or hemisphere light has no position; a
point light shines from the component's world position; a directional or spot
light shines from the component's world position along its forward axis, which
is `FORWARD` turned by the component's world rotation.

```ts
import {
  Actor,
  LightComponent,
  quatLookAt,
  vec3,
} from "@test-cabinet/structured-3d";

export class Rig extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({
        light: { kind: "hemisphere", sky: "#cfe3ff", ground: "#3a3328", intensity: 0.6 },
      }),
    );
    const sun = this.attach(
      new LightComponent({
        light: { kind: "directional", intensity: 1.2, castShadow: true },
      }),
    );
    sun.offset.position = vec3(10, 20, 10);
    sun.offset.rotation = quatLookAt(vec3(-1, -2, -1));
  }
}
```

`quatLookAt` takes the direction the light shines in, so the sun above points
down toward the origin from its offset. A light rides its actor like any other
component: move the actor and the light moves, disable the component and the
light goes out. `castShadow` on the light takes effect once the engine is
created with `shadows: true` and a mesh declares `receiveShadow`, which the
[models page](/engines/structured-3d/usage/models-and-animation/) sets up.

## A HUD

`TextComponent` and `SpriteComponent` are screen-space components: their
transform, their `offset`, their sizes, and a font size are logical units
measured from the top-left of the design field, so a readout holds its place
on the canvas whatever the camera does. A HUD is an actor whose components are
all screen-space, each offset to its logical position.

```ts
import {
  Actor,
  SpriteComponent,
  TextComponent,
} from "@test-cabinet/structured-3d";
import { HEIGHT, LAYER, PALETTE, WIDTH } from "./constants";
import { images } from "./images";

export class Hud extends Actor {
  readonly score: TextComponent;
  readonly life: SpriteComponent;

  constructor() {
    super();
    this.score = this.attach(
      new TextComponent({
        text: "0 - 0",
        font: "24px monospace",
        fill: PALETTE.hud,
      }),
    );
    this.score.offset.position.x = WIDTH / 2;
    this.score.offset.position.y = 30;
    this.score.layer = LAYER.hud;

    this.life = this.attach(
      new SpriteComponent({ image: images.heart, width: 24, height: 24 }),
    );
    this.life.offset.position.x = 30;
    this.life.offset.position.y = HEIGHT - 30;
    this.life.layer = LAYER.hud;
  }

  tick(): void {
    const scores = this.world.state.players.map((player) => player.score);
    this.score.text = scores.join(" - ");
  }
}
```

`font` defaults to `"16px sans-serif"`, `fill` to `"#ffffff"`, `align` to
`"center"`, and `baseline` to `"middle"`. An `ImageBitmap` for a sprite is
loaded with `assets.loadImage` in a level's `load` and held in a module the
way a texture is. `width` and `height` default to the source region's pixel
size, and `anchorX` and `anchorY` default to `0.5`, which centers the sprite
on its transform.

The viewport fit scales the whole screen layer, and by default a scaled image
is resampled bilinearly. Pixel art stays crisp by creating the engine with
`imageSmoothing: false`, which samples every image the screen pass draws
nearest-neighbor:

```ts
const engine = createEngine({
  canvas,
  width: WIDTH,
  height: HEIGHT,
  game,
  imageSmoothing: false,
});
```

A sheet is one image with a `source` region selecting the frame, and the region
is a field the actor writes:

```ts
private elapsed = 0;

tick(dt: number): void {
  this.elapsed += dt;
  const frame = Math.floor(this.elapsed * 12) % 4;
  this.life.source = { x: frame * 16, y: 0, width: 16, height: 16 };
}
```

## Choosing layers

`layer` defaults to `0`. Number the layers in one place, leave gaps between
them, and give every component a layer from that table rather than a literal.
One table serves both spaces, because the two are sorted separately and every
screen-space component draws over every world-space one.

In world space `layer` is the object's `renderOrder`: three draws the opaque
objects and then the transparent ones, orders each set by `renderOrder`, and
depth testing decides which surface is seen where they overlap. A world layer
therefore settles the order among transparent surfaces and among objects that
share a depth, and leaves occlusion to depth. In screen space `layer` orders
the HUD, and within a layer the pipeline orders by the owning actor's spawn
order and then by attachment order, with a stable sort. Two screen components
that must overlap in a fixed order belong on two layers, or on one actor
attached in the order they should draw.

## Opacity and visibility

Every render component carries `layer`, `visible`, and `opacity`. `visible`
defaults to `true`, and `opacity` defaults to `1` and is clamped to `0..1`. A
component's `opacity` multiplies its material's, and an object below `1` draws
in the transparent pass. A sprite adds `tint`, and `null` drops it.

```ts
private invulnerable = 0;

tick(dt: number): void {
  this.invulnerable = Math.max(0, this.invulnerable - dt);

  if (this.invulnerable > 0) {
    this.hull.visible = Math.floor(this.invulnerable * 10) % 2 === 0;
    this.hull.opacity = 0.6;
  } else {
    this.hull.visible = true;
    this.hull.opacity = 1;
  }
}
```

`visible` takes a component out of the picture and leaves it ticking. The
component's own `enabled` is the wider switch: a disabled component skips its
tick, draws nothing, and takes no part in collision. A `LightComponent` follows
`visible` and `enabled` like the rest of the picture and takes no opacity.

## Following an actor with the camera

Attach a `CameraComponent` to the actor the view should follow, and point the
world's camera at that actor. Each frame the camera takes the world position,
rotation, and `fov` of the first enabled `CameraComponent` the target holds,
then clamps its position to `camera.bounds`. The ship above becomes the view
target by attaching the component and following itself:

```ts
constructor() {
  super();
  this.hull = this.attach(
    new MeshComponent({
      geometry: { kind: "box", width: 2, height: 0.6, depth: 3 },
      material: { map: textures.hull },
    }),
  );
  this.hull.layer = LAYER.actors;

  const view = this.attach(new CameraComponent({ fov: 50 }));
  view.offset.position = vec3(0, 2.5, 7);
  view.offset.rotation = quatFromEuler(-0.25, 0, 0);
}

beginPlay(): void {
  this.world.camera.follow(this);
  this.world.camera.bounds = { min: vec3(-40, 1, -40), max: vec3(40, 30, 40) };
}
```

The component's `offset` is composed with the actor's transform, so the offset
above sits behind and above the ship in the ship's own frame, pitched down a
quarter radian, and turns with it. A chase camera is therefore an offset rather
than a second actor. `follow(null)` releases the target and leaves the camera
wherever the game writes `position`, `rotation`, and `fov`, and `lookAt` writes
the rotation for a camera aimed at a point.

## Drawing directly

The direct path into the world pass is `Object3DComponent`. The subtree under
its `object` is the game's own three objects: the pipeline places the root at
the component's world transform every frame and applies `visible` and
`opacity`, and the game mutates everything inside directly. The render modes
substitute its materials at draw time as they do for any other component.

```ts
import * as THREE from "three";
import {
  Actor,
  MeshComponent,
  Object3DComponent,
  quatFromEuler,
} from "@test-cabinet/structured-3d";
import { LAYER, PALETTE } from "./constants";

const SPARKS = 48;

export class Ship extends Actor {
  readonly hull: MeshComponent;
  private readonly sparks: THREE.BufferAttribute;

  constructor() {
    super();
    this.hull = this.attach(
      new MeshComponent({
        geometry: { kind: "cylinder", radiusTop: 0, radiusBottom: 0.6, height: 2 },
        material: { color: PALETTE.ship, flatShading: true },
      }),
    );
    this.hull.offset.rotation = quatFromEuler(-Math.PI / 2, 0, 0);
    this.hull.layer = LAYER.actors;

    this.sparks = new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3);
    for (let i = 0; i < SPARKS; i += 1) {
      this.sparks.setXYZ(i, 0, 0, 1 + (2 * i) / SPARKS);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", this.sparks);
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: PALETTE.exhaust, size: 0.15 }),
    );
    const exhaust = this.attach(new Object3DComponent({ object: points }));
    exhaust.layer = LAYER.effects;
  }

  tick(dt: number): void {
    for (let i = 0; i < SPARKS; i += 1) {
      const z = this.sparks.getZ(i) + 4 * dt;
      this.sparks.setXYZ(i, 0.2 * Math.sin(i), 0.2 * Math.cos(i), z > 3 ? 1 : z);
    }
    this.sparks.needsUpdate = true;
  }
}
```

The cone's offset turns its tip along the ship's forward axis, and the sparks
drift along local `+Z`, behind it. The subtree is in the component's local
frame, so the exhaust follows the ship without the tick placing it.

A case that measures the drawing on the screen layer uses a `DrawComponent`.
The engine calls `draw` in the component's place in the screen pass, with the
context already carrying the viewport transform, so the component draws in
logical units. A world point lands under its pen through the camera's
`worldToLogical`:

```ts
import { DrawComponent, type DrawApi } from "@test-cabinet/structured-3d";
import { PALETTE } from "./constants";

export class Marker extends DrawComponent {
  draw(api: DrawApi): void {
    const at = this.world.camera.worldToLogical(this.actor.transform.position);
    if (!at.visible) return;
    const { ctx } = api;

    ctx.save();
    ctx.beginPath();
    ctx.arc(at.x, at.y, 12, 0, Math.PI * 2);
    ctx.lineWidth = api.mode === "wireframe" ? 1 : 2;
    ctx.strokeStyle = PALETTE.hud;
    ctx.globalAlpha = api.mode === "shaded" ? this.opacity : 1;
    ctx.stroke();
    ctx.restore();
  }
}
```

Render modes belong to the declarative pipeline, so a `DrawComponent` reads
`api.mode` and supplies its own. Attach it like any other render component,
give it a layer, and balance `save` and `restore` around a transformed or
restyled subtree, so the components drawn after it start from the transform and
the styles the pipeline handed over.

## Switching the mode

The renderer's two switches are reached from the engine and take effect on the
next frame:

```ts
engine.renderer.setMode("wireframe");
engine.renderer.setCollisionOverlay(true);
```

Wireframe shows the geometry a build placed, `unlit` shows every base color and
map with the lighting taken out, and `normals` shows which way every surface
faces, so all three are worth looking at while the picture is being built. The
mode substitutes materials at draw time for everything in the world pass,
`Object3DComponent` subtrees and models included, so a build has every mode
without implementing any.
