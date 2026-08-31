---
title: Rendering
---

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the pipeline collects them, orders them, and draws
them once per frame. The
[component catalogue](/engines/structured-2d/apis/components/) covers what each
built-in component draws; this page covers the pipeline that draws them.

## `RenderMode`

```ts
type RenderMode = "shaded" | "wireframe" | "unlit" | "silhouette";
```

| Mode | Draws |
| --- | --- |
| `shaded` | The full picture: fills, strokes, images, text, tint, and opacity. The default. |
| `wireframe` | Each component's outline alone, at one stroke width, with images reduced to their bounds. |
| `unlit` | Fills and images at full opacity with every tint dropped. |
| `silhouette` | Each component filled flat in its layer's color, in layer order. |

The mode belongs to the pipeline and applies to every component it draws, so
every game has all four modes available.

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

The collision overlay draws every enabled collider's shape over the finished
picture, in a color per response, and is independent of the mode.

## The pipeline

Each frame, after the ticks and after any transition:

1. The camera is updated: a world following a view target takes that target's
   world transform and zoom, then the result is clamped to `camera.bounds`.
2. The canvas is cleared to `background`, or to transparency when none was
   given, and the context's image smoothing is set from `imageSmoothing`.
3. The engine collects every enabled, visible `RenderComponent` on every live
   actor.
4. The collection is sorted by `layer` ascending, and within a layer by the
   owning actor's spawn order, and within an actor by attachment order.
5. Each component is drawn with the context carrying the world-to-device
   transform. A `DrawComponent` receives `DrawApi` and draws itself.
6. The collision overlay draws, when it is enabled.
7. The debug overlay draws in device space.

Step 3 reads `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either is
cleared. A destroyed actor stops rendering immediately, before the end-of-frame
flush removes it from the world.

Step 5 composes the camera and then the viewport into one transform, so a
component states every coordinate, size, and font size in world units. The
[camera](/engines/structured-2d/apis/camera/) page specifies both maps.

## The sort

The sort key is `layer` ascending, then the owning actor's spawn order, then
attachment order within that actor. `layer` defaults to `0`, so components a
game leaves at the default draw in spawn order.

The sort is stable, so a redraw with no change reproduces the previous order
exactly. Two components sharing a layer, an actor, and an attachment position
cannot exist, so the order is total and a frame is reproducible from the world
alone.

## Image smoothing

The viewport fit scales the whole picture, so an image drawn at its pixel size
in world units still covers more or fewer device pixels than it has. How those
device pixels are filled is
[`EngineOptions.imageSmoothing`](/engines/structured-2d/apis/engine/). `true`,
the default, resamples bilinearly; `false` samples nearest-neighbor, so each
image pixel becomes a block of device pixels and pixel art stays crisp at every
fit.

The pipeline sets the context's `imageSmoothingEnabled` from the option in
step 2 of every frame, before any component draws, so every `SpriteComponent`
blit and the scratch a tinted sprite is flattened on sample the same way, and
a `DrawComponent` receives the context already carrying the setting. The
option is fixed for the engine's lifetime and applies under every render mode
that draws an image.

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
| `ctx` | The 2D context, already carrying the world-to-device transform. |
| `mode` | The mode in force for this frame. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `camera` | The camera's position, zoom, and rotation for this frame. |

`DrawComponent` is the direct-drawing path, for a case that measures the drawing
itself. The engine calls `draw` in the component's place in the layer order,
with the context already carrying the world-to-device transform, so the
component draws in world units.

Render modes belong to the declarative pipeline, so a `DrawComponent` reads
`api.mode` and supplies its own render modes.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

## Exports

`RenderMode`, `Renderer`, and `DrawApi` are exported as types, and
`DrawComponent` as an abstract class, from `@test-cabinet/structured-2d`. The
render components the pipeline draws are exported from the same specifier and
listed on the [components](/engines/structured-2d/apis/components/) page.
