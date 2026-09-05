# Rendering

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the pipeline collects them, orders them, and draws
them once per frame in **two passes**: the world pass renders a three scene
through the camera, and the screen pass draws the screen layer over it.
`components.md` covers what each built-in component draws; this page covers the
pipeline that draws them.

| Surface | Object | Populated by | Drawn by |
| --- | --- | --- | --- |
| The scene | A `THREE.Scene`, rendered through a `THREE.WebGLRenderer` over the canvas | The pipeline, from the world's `world` components | The engine, through the camera |
| The screen layer | A 2D canvas the engine owns, sized to the same backing store | The world's `screen` components | The engine, composited over the scene |

## The scene the pipeline maintains

`engine.scene` is the one `THREE.Scene` the engine renders, created empty at
construction and kept for the engine's life. **The pipeline owns its contents.**
Each enabled, visible `world` component holds one three object the pipeline
built for it: a mesh from a `MeshComponent`'s geometry and material, a light
from a `LightComponent`'s spec, the clone a `ModelComponent` made, or the root
of an `Object3DComponent`'s subtree.

Every frame the pipeline places that object at the component's world transform,
applies the component's `visible` and `opacity`, sets its `renderOrder` from
`layer`, and rebuilds it when the component's `geometry`, `material`, or `light`
field is assigned a new value. A game therefore never adds to or removes from
the scene: it attaches and detaches components, and reads the scene to see what
the pipeline placed.

A component's `opacity` multiplies its material's, and an object below `1` draws
in the transparent pass.

## Lights

The scene starts with no light, so a `standard` or `lambert` material renders
black until an actor carries a `LightComponent`. A level's lighting rig is an
actor that carries them, placed by the level like any other:

```ts
import { Actor, LightComponent, vec3 } from "@clockwyrks/structured-3d";

export class Rig extends Actor {
  constructor() {
    super();

    this.attach(
      new LightComponent({
        light: { kind: "hemisphere", sky: "#cfe4ff", ground: "#3a3324", intensity: 0.6 },
      }),
    );

    const sun = this.attach(
      new LightComponent({
        light: { kind: "directional", color: "#fff4e0", intensity: 1.4, castShadow: true },
      }),
    );
    sun.offset.position = vec3(10, 16, 6);
  }
}
```

An ambient or hemisphere light for the fill and one directional light for the
key is a rig that reads well and records well. A directional or spot light
shines from the component's world position along `FORWARD` turned by the
component's world rotation, so aiming it is turning its offset.

## Shadows

Shadows are on when three things agree: the engine is created with
`shadows: true`, a directional or spot light declares `castShadow` in its spec,
and the meshes declare which side of a shadow they are on. `castShadow` and
`receiveShadow` on a `MeshComponent` or a `ModelComponent` default to `false`.

```ts
const engine = createEngine({ canvas, width: WIDTH, height: HEIGHT, game, shadows: true });
```

```ts
this.body = this.attach(new MeshComponent({ geometry: BODY, material: HULL }));
this.body.castShadow = true;

this.ground = this.attach(
  new MeshComponent({
    geometry: { kind: "box", width: 40, height: 0.2, depth: 40 },
    material: { color: PALETTE.ground },
  }),
);
this.ground.receiveShadow = true;
```

Shadow maps are filtered soft (PCF), and a model's meshes cast and receive as
one, so a rig is shadowed by setting the two flags on the component rather than
on each part. A game that needs no shadows leaves the option off and pays
nothing for the maps.

## The pipeline

Each frame, after the ticks and after any transition:

1. The camera is updated: a world following a view target takes that target's
   world position, rotation, and `fov`, then the position is clamped to
   `camera.bounds`.
2. Each enabled, visible `world` component's object is synced: rebuilt if its
   declaration changed, placed at the component's world transform, visibility
   and opacity applied, a billboard turned to the camera, a model's mixer
   advanced by the world's delta.
3. The canvas is cleared to `background`, or to transparency when none was
   given; the letterboxed viewport and scissor are applied; the scene is
   rendered through the camera under the mode.
4. The collision overlay draws, when it is enabled.
5. The screen layer is cleared and given the viewport transform, and its image
   smoothing is set from `imageSmoothing`. Every enabled, visible `screen`
   component draws in `layer` order. A `DrawComponent` receives `DrawApi` and
   draws itself.
6. The recorder captures the frame, when it is armed.
7. The debug overlay draws on the screen layer in device space.
8. The screen layer is composited over the picture.

Steps 2 and 5 read `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either is
cleared. A destroyed actor stops rendering immediately, before the end-of-frame
flush removes it from the world.

## The sort

The two passes are ordered separately.

- In the **world pass**, `layer` is the object's `renderOrder`: three sorts the
  opaque draws and then the transparent draws, orders each set by `renderOrder`,
  and depth testing decides which surface is seen where they overlap.
- In the **screen pass**, the sort key is `layer` ascending, then the owning
  actor's spawn order, then attachment order within that actor. The sort is
  stable, so a redraw with no change reproduces the previous order exactly.

Every `screen` component draws over every `world` one, whatever their layers.

Number the layers in one place, leave gaps between them, and give every
component a layer from that table rather than a literal:

```ts
export const LAYER = { field: 0, actors: 10, effects: 20, hud: 30 } as const;
```

## Image smoothing

The viewport fit scales the whole screen layer, so an image drawn at its pixel
size in logical units still covers more or fewer device pixels than it has. How
those device pixels are filled is `EngineOptions.imageSmoothing`. `true`, the
default, resamples bilinearly; `false` samples nearest-neighbor, so each image
pixel becomes a block of device pixels and pixel art stays crisp at every fit.

The pipeline sets the screen layer's `imageSmoothingEnabled` from the option in
step 5 of every frame, before any `screen` component draws. A material's `map`
in the world pass is sampled by three under the texture's own filtering.

## `RenderMode`

```ts
type RenderMode = "shaded" | "wireframe" | "unlit" | "normals";
```

| Mode | World pass | Screen pass |
| --- | --- | --- |
| `shaded` | Every material as declared, lit by the scene's lights. The default. | The full picture: fills, strokes, images, text, tint, and opacity. |
| `wireframe` | Every mesh as its edges in one flat color, lights ignored. | Each component's outline alone, at one stroke width, with images reduced to their bounds. |
| `unlit` | Every material's base color and map at full opacity, lights ignored. | Fills and images at full opacity with every tint dropped. |
| `normals` | Every surface colored by its world-space normal, lights ignored. | The full picture. |

The mode belongs to the pipeline and applies to everything it draws, so every
game has all four modes available without writing anything. In the world pass
the mode substitutes materials at draw time, `Object3DComponent` subtrees and
loaded models included. Wireframe shows the geometry a build placed and normals
shows how its surfaces face, so both are worth looking at while the picture is
being built.

## `Renderer`

```ts
interface Renderer {
  mode(): RenderMode;
  setMode(mode: RenderMode): void;
  collisionOverlay(): boolean;
  setCollisionOverlay(enabled: boolean): void;
}
```

| Member | Effect |
| --- | --- |
| `mode` | The mode in force, `shaded` until it is set. |
| `setMode` | Sets the mode. The next frame the pipeline runs draws under it. |
| `collisionOverlay` | Whether the collision overlay draws. |
| `setCollisionOverlay` | Turns the collision overlay on or off. |

The renderer is reached as `engine.renderer` and is available from construction,
so whoever holds the engine drives both switches:

```ts
engine.renderer.setMode("wireframe");
engine.renderer.setCollisionOverlay(true);
```

The collision overlay draws every enabled collider's shape as a wireframe in the
world pass, in a color per response, after the scene and with depth testing off,
and is independent of the mode. See `collision.md`.

## The background

Two colors, at two different scopes.

- `EngineOptions.background` is the CSS color the **whole canvas** is cleared to
  before the scene is rendered, letterbox bars included. Absent, the canvas
  clears to transparency and the page shows through.
- A `screen` component drawn across the whole design field paints **inside the
  picture**, over everything the scene drew — which is what a title card, a
  fade, or a pause veil is.

## The screen layer

The screen layer is a 2D canvas the engine owns, sized to the same backing store
as the stage canvas, cleared at the top of every screen pass, given the viewport
transform, and composited over the 3D picture at the end of the frame. Wherever
it is transparent the scene shows through.

A HUD is an actor whose components are `screen` components, each offset to its
logical position, on a layer above the field:

```ts
import { Actor, ShapeComponent, TextComponent, vec3 } from "@clockwyrks/structured-3d";
import { LAYER, WIDTH } from "./constants";

export class Hud extends Actor {
  readonly score: TextComponent;

  constructor() {
    super();

    const bar = this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: WIDTH, height: 48 },
        fill: "rgba(0, 0, 0, 0.5)",
      }),
    );
    bar.offset.position = vec3(WIDTH / 2, 24, 0);
    bar.layer = LAYER.hud;

    this.score = this.attach(
      new TextComponent({
        text: "0",
        font: "20px monospace",
        align: "left",
        baseline: "middle",
      }),
    );
    this.score.offset.position = vec3(16, 24, 0);
    this.score.layer = LAYER.hud;
  }

  override tick(): void {
    this.score.text = `SCORE ${this.world.state.players[0]?.score ?? 0}`;
  }
}
```

## Direct drawing

A picture the built-in components cannot state is drawn with a `DrawComponent`.
The engine calls `draw` in the component's place in the screen pass's layer
order, with the context already carrying the viewport transform, so the
component draws in logical units. A component that draws against the world reads
`api.camera()` and projects world points through `camera.worldToLogical`.

```ts
import { DrawComponent } from "@clockwyrks/structured-3d";
import type { DrawApi } from "@clockwyrks/structured-3d";
import { PALETTE } from "./constants";

export class Markers extends DrawComponent {
  draw(api: DrawApi): void {
    const { ctx } = api;
    const camera = this.world.camera;

    ctx.save();
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    for (const target of this.world.byTag("target")) {
      const at = camera.worldToLogical(target.transform.position);
      if (!at.visible) continue;

      ctx.fillStyle = api.mode === "wireframe" ? PALETTE.hud : PALETTE.marker;
      ctx.fillText(`#${target.id}`, at.x, at.y);
    }

    ctx.restore();
  }
}
```

Attach it like any other render component, and give it a layer. Balance `save`
and `restore` around a transformed or restyled subtree, so the components drawn
after it start from the transform and the styles the pipeline handed over. The
context arrives with image smoothing set from `imageSmoothing`, so an image a
`DrawComponent` draws samples the way a sprite does.

`DrawApi` also carries `frame()` (the frame counter, the accumulated simulated
time, and the most recent delta), `viewport()` (the current logical-to-device
fit), and `camera()` (the camera's pose and projection for this frame), each as
a snapshot the caller owns.

The direct path into the **world** pass is `Object3DComponent`, whose subtree
the game builds from its own three objects. See `components.md`.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline, so the simulation is examinable
independently of any drawing surface.
