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

| Mode         | Draws                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| `shaded`     | The full picture: fills, strokes, images, text, tint, and opacity. The default.           |
| `wireframe`  | Each component's outline alone, at one stroke width, with images reduced to their bounds. |
| `unlit`      | Fills and images at full opacity with every tint dropped.                                 |
| `silhouette` | Each component filled flat in its layer's color, in layer order.                          |

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

| Member                | Effect                                                          |
| --------------------- | --------------------------------------------------------------- |
| `mode`                | The mode in force, `shaded` until it is set.                    |
| `setMode`             | Sets the mode. The next frame the pipeline runs draws under it. |
| `collisionOverlay`    | Whether the collision overlay draws.                            |
| `setCollisionOverlay` | Turns the collision overlay on or off.                          |

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
5. Each component is drawn with the context carrying the transform of its
   `space`: the world-to-device transform for a `world` component, the
   viewport alone for a `screen` one. A `DrawComponent` receives `DrawApi` and
   draws itself.
6. The collision overlay draws, when it is enabled.
7. The debug overlay draws in device space.

Steps 5 and 6 draw inside a clip on the logical field: the context is saved,
clipped to `0..width` by `0..height` in logical coordinates, and restored once
the collision overlay has drawn. A world component projected past the field's
edge and a screen component drawn outside the field both stop at the letterbox
bar, so the bars hold `background` alone whatever the game draws. The clip is
set in device space before any component draws, so the transform a component
is handed leaves it where it is, and a clip a component sets of its own
intersects with it.

That `restore` closes the frame, so a style or transform a `DrawComponent` sets
lasts until then. A `save` a component leaves open is what the `restore` pops
instead, which keeps the clip in force through the next frame's clear and over
the debug overlay drawn that frame, and a `restore` beyond the component's own
`save`s lifts the clip for the rest of the frame.

Step 3 reads `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either is
cleared. A destroyed actor stops rendering immediately, before the end-of-frame
flush removes it from the world.

Step 5 composes the camera and then the viewport into one transform for a
`world` component, so it states every coordinate, size, and font size in world
units, and applies the viewport alone for a `screen` component, which states
them in logical units. The [camera](/engines/structured-2d/apis/camera/) page
specifies both maps.

## The sort

The sort key is `layer` ascending, then the owning actor's spawn order, then
attachment order within that actor. `layer` defaults to `0`, so components a
game leaves at the default draw in spawn order.

The sort is stable, so a redraw with no change reproduces the previous order
exactly. Two components sharing a layer, an actor, and an attachment position
cannot exist, so the order is total and a frame is reproducible from the world
alone.

## Screen space

```ts
type RenderSpace = "world" | "screen";
```

`RenderComponent.space` selects which map a component draws through. `"world"`,
the default, draws through the camera and then the viewport. `"screen"` draws
through the viewport alone: the component's composed transform, its actor's
transform with its `offset`, is read in logical units from the top-left of the
design field, and every size and font size it states is a logical unit. A
`screen` component therefore holds its place on the canvas whatever the
camera's position, zoom, and rotation are.

Both spaces share the one sort, so a `screen` component's `layer` places it
among the `world` components exactly as a `world` component's does. The render
modes apply to a `screen` component as to any other, and the collision overlay
stays in world space.

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
  readonly space: RenderSpace;
  frame(): FrameInfo;
  viewport(): Viewport;
  camera(): CameraSnapshot;
}

abstract class DrawComponent extends RenderComponent {
  abstract draw(api: DrawApi): void;
}
```

| Member     | Meaning                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `ctx`      | The 2D context, already carrying the transform of the component's `space`.                         |
| `mode`     | The mode in force for this frame.                                                                  |
| `space`    | The component's space: `world` for the world-to-device transform, `screen` for the viewport alone. |
| `frame`    | The frame counter, the accumulated simulated time, and the most recent delta.                      |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns.                                  |
| `camera`   | The camera's position, zoom, and rotation for this frame.                                          |

`DrawComponent` is the direct-drawing path, for a case that measures the drawing
itself. The engine calls `draw` in the component's place in the layer order,
with the context already carrying the transform of the component's `space`, so
a `world` component draws in world units and a `screen` component in logical
units.

Render modes belong to the declarative pipeline, so a `DrawComponent` reads
`api.mode` and supplies its own render modes.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

## Exports

`RenderMode`, `RenderSpace`, `Renderer`, and `DrawApi` are exported as types,
and `DrawComponent` as an abstract class, from `@clockwyrks/structured-2d`. The
render components the pipeline draws are exported from the same specifier and
listed on the [components](/engines/structured-2d/apis/components/) page.
