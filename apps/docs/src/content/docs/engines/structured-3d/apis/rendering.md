---
title: Rendering
---

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the pipeline collects them, orders them, and draws
them once per frame in two passes: the world pass renders a three scene through
the camera, and the screen pass draws the screen layer over it. The
[component catalogue](/engines/structured-3d/apis/components/) covers what each
built-in component draws; this page covers the pipeline that draws them.

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
game has all four modes available. In the world pass the mode substitutes
materials at draw time, `Object3DComponent` subtrees and loaded models included,
so a build has every mode without implementing any.

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

The renderer is reached as `engine.renderer` and is available from
construction, so whoever holds the engine drives both switches.

The collision overlay draws every enabled collider's shape as a wireframe in the
world pass, in a color per response, after the scene and with depth testing
off, and is independent of the mode.

## The scene

The world pass renders one `THREE.Scene`, reached as `engine.scene`, that the
pipeline maintains. Each enabled, visible `world` component holds one three
object the pipeline owns: a mesh built from a `MeshComponent`'s geometry and
material, a light built from a `LightComponent`'s spec, the clone a
`ModelComponent` made of its model, or the root of an `Object3DComponent`'s
subtree. The pipeline places the object at the component's world transform
every frame, applies the component's `visible` and `opacity`, sets its
`renderOrder` from `layer`, and rebuilds it when the component's `geometry`,
`material`, or `light` field is assigned a new value.

A component's `opacity` multiplies its material's, and an object below `1`
draws in the transparent pass. A `LightComponent` lights the scene from the
component's world transform and takes no opacity. A game reads the scene to
inspect what the pipeline placed and writes to it through components.

## The pipeline

Each frame, after the ticks and after any transition:

1. The camera is updated: a world following a view target takes that target's
   world position, rotation, and `fov`, then the result is clamped to
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
   component draws in `layer` order, and within a layer by the owning actor's
   spawn order, and within an actor by attachment order. A `DrawComponent`
   receives `DrawApi` and draws itself.
6. The recorder captures the frame, when it is armed.
7. The debug overlay draws on the screen layer in device space.
8. The screen layer is composited over the picture.

Steps 2 and 5 read `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either is
cleared. A destroyed actor stops rendering immediately, before the end-of-frame
flush removes it from the world.

Step 3 renders through the camera's projection with its aspect held at
`width / height`, into the letterboxed rectangle of the canvas, so a world
point lands at the logical stage point `camera.worldToLogical` reports. Step 5
applies the viewport alone, so a `screen` component states every coordinate,
size, and font size in logical units. The
[camera](/engines/structured-3d/apis/camera/) page specifies both maps.

## The sort

The two passes are ordered separately. In the world pass, `layer` is the
object's `renderOrder`: three sorts the opaque draws and then the transparent
draws, orders each set by `renderOrder`, and depth testing decides which
surface is seen where they overlap. In the screen pass, the sort key is `layer`
ascending, then the owning actor's spawn order, then attachment order within
that actor. `layer` defaults to `0`, so `screen` components a game leaves at the
default draw in spawn order.

The screen sort is stable, so a redraw with no change reproduces the previous
order exactly. Two components sharing a layer, an actor, and an attachment
position cannot exist, so the order is total and a frame is reproducible from
the world alone. Every `screen` component draws over every `world` one,
whatever their layers.

## Screen space

```ts
type RenderSpace = "world" | "screen";
```

`RenderComponent.space` is fixed by a component's class and selects the pass it
draws in. A `world` component draws in the world pass, through the camera and
into the viewport. A `screen` component draws in the screen pass, on the screen
layer, through the viewport alone: the component's composed transform, its
actor's transform with its `offset`, is read as `position.x` and `position.y`
in logical units from the top-left of the design field, the quaternion's yaw
about `+Z`, and `scale.x` and `scale.y`, and every size and font size it states
is a logical unit. A `screen` component therefore holds its place on the canvas
whatever the camera's position, rotation, and projection are.

The screen layer is a 2D canvas the engine owns, sized to the same backing
store as the canvas, cleared at the top of every screen pass, and composited
over the 3D picture at the end of the frame. The render modes apply to a
`screen` component as to any other, and the collision overlay stays in the
world pass.

## Image smoothing

The viewport fit scales the whole screen layer, so an image drawn at its pixel
size in logical units still covers more or fewer device pixels than it has. How
those device pixels are filled is
[`EngineOptions.imageSmoothing`](/engines/structured-3d/apis/engine/). `true`,
the default, resamples bilinearly; `false` samples nearest-neighbor, so each
image pixel becomes a block of device pixels and pixel art stays crisp at every
fit.

The pipeline sets the screen layer's `imageSmoothingEnabled` from the option in
step 5 of every frame, before any `screen` component draws, so every
`SpriteComponent` blit and the scratch a tinted sprite is flattened on sample
the same way, and a `DrawComponent` receives the context already carrying the
setting. The option is fixed for the engine's lifetime and applies under every
render mode that draws an image. A material's `map` in the world pass is
sampled by three under the texture's own filtering.

## Direct drawing

```ts
interface DrawApi {
  readonly ctx: CanvasRenderingContext2D;
  readonly mode: RenderMode;
  frame(): FrameInfo;
  viewport(): Viewport;
  camera(): CameraSnapshot;
}

abstract class DrawComponent extends RenderComponent {
  abstract draw(api: DrawApi): void;
}
```

| Member | Meaning |
| --- | --- |
| `ctx` | The screen layer's 2D context, already carrying the viewport transform. |
| `mode` | The mode in force for this frame. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `camera` | The camera's pose and projection for this frame, as a snapshot the caller owns. |

`DrawComponent` is the direct-drawing path onto the screen layer, for a case
that measures the drawing itself. The engine calls `draw` in the component's
place in the screen pass's layer order, with the context already carrying the
viewport transform, so the component draws in logical units. A game that draws
against the world reads `api.camera()` and projects world points through
`camera.worldToLogical`. The direct path into the world pass is
`Object3DComponent`, whose subtree the game builds from its own three objects.

Render modes belong to the declarative pipeline, so a `DrawComponent` reads
`api.mode` and supplies its own render modes.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

## Exports

`RenderMode`, `RenderSpace`, `Renderer`, and `DrawApi` are exported as types,
and `DrawComponent` as an abstract class, from `@test-cabinet/structured-3d`. The
render components the pipeline draws are exported from the same specifier and
listed on the [components](/engines/structured-3d/apis/components/) page.
