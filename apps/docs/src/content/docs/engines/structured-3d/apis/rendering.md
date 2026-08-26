---
title: Rendering
---

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the pipeline collects them, orders them, and draws
them once per frame. The
[component catalogue](/engines/structured-3d/apis/components/) covers what each
built-in component draws; this page covers the pipeline that draws them.

## `RenderMode`

```ts
type RenderMode = "standard" | "wireframe" | "unlit" | "normals";
```

| Mode | Draws |
| --- | --- |
| `standard` | The full picture: materials and colors lit by the lights, tint, and opacity. The default. |
| `wireframe` | Each component's geometry as its triangle edges alone, unlit, at one stroke width, in the component's color (`#ffffff` for a component whose color is `null`). |
| `unlit` | Base colors and textures at full brightness and full opacity, with lighting and every tint dropped. |
| `normals` | Each pixel colored by its world-space surface normal, mapped as `rgb = (n + 1) / 2`. |

The mode belongs to the pipeline and applies to every draw of the frame,
scene-context draws from a `DrawComponent` included, so every game has all four
modes without implementing any of them.

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
| `mode` | The mode in force, `standard` until it is set. |
| `setMode` | Sets the mode. The next frame the pipeline runs draws under it. |
| `collisionOverlay` | Whether the collision overlay draws. |
| `setCollisionOverlay` | Turns the collision overlay on or off. |

The renderer is reached as `engine.renderer` and is available from
construction, so whoever holds the engine drives both switches.

The collision overlay draws every enabled collider's shape over the finished
picture, in a color per response, and is independent of the mode.

## The pipeline

Each frame, after the ticks and after any transition:

1. The camera is updated: a world following a view target adopts that target's
   first enabled `CameraComponent`'s world position and rotation and its
   `fovY`.
2. The renderer state is set on the scene context: the mode, the camera's
   `CameraState`, and the lights collected from the enabled light components
   on live actors, in spawn order then attachment order — or the default rig
   when there are none.
3. The canvas is cleared to `background` (transparency when none was given)
   and the depth state is reset. The viewport letterboxes the logical field
   onto the canvas; the renderer draws inside the fit and the letterbox bars
   are cleared outside the picture.
4. The engine collects every enabled, visible `RenderComponent` on every live
   actor.
5. The collection is sorted by `layer` ascending, then by the owning actor's
   spawn order, then by attachment order. The sort is stable.
6. The layers draw in ascending order, and the depth buffer is cleared before
   each layer, so a later layer draws over an earlier one however near the
   earlier one's geometry sits. Within a layer, components at opacity `1` draw
   in sort order with the depth buffer ordering their fragments; components
   below opacity `1` draw afterwards, farthest from the camera first (by their
   world positions' distance to the camera, ties broken by the sort order). A
   `DrawComponent` receives `DrawApi` and draws itself in its place.
7. The collision overlay draws, when it is enabled: every enabled collider's
   shape as wireframe outlines over the finished picture, in a color per
   response, with depth testing off.
8. The debug overlay draws on the engine's overlay surface, in device space,
   above the rendering canvas.

Step 4 reads `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either
is cleared. A destroyed actor stops rendering immediately, before the
end-of-frame flush removes it from the world.

The sort is stable, so a redraw with no change reproduces the previous order
exactly. Two components sharing a layer, an actor, and an attachment position
cannot exist, so the order is total and a frame is reproducible from the world
alone. Clearing the depth buffer between layers is the HUD idiom: a 3D scene
on layer `0` and a billboard `TextComponent` score on layer `1` draw the score
over the scene whatever the geometry between them.

## Direct drawing

```ts
interface DrawApi {
  readonly scene: SceneContext;
  readonly mode: RenderMode;
  frame(): FrameInfo;
  viewport(): Viewport;
  camera(): CameraState;
}

abstract class DrawComponent extends RenderComponent {
  abstract draw(api: DrawApi): void;
}
```

| Member | Meaning |
| --- | --- |
| `scene` | The scene context the pipeline draws through, with this frame's camera, lights, and mode already in force. |
| `mode` | The render mode in force for this frame. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `camera` | The camera's state for this frame, as a `CameraState` the caller owns. |

`DrawComponent` is the direct-drawing path, for a case that measures the
drawing itself. The engine calls `draw` in the component's place in the layer
order, and the component issues scene-context draw calls in world units. The
draw-call vocabulary is the one
[`simple-3d`](/engines/simple-3d/apis/game/) games render through, so both
engines' recordings replay in one player.

The render mode is renderer state the scene context holds, so a
`DrawComponent`'s calls are drawn under the mode in force without the component
implementing anything; `api.mode` remains readable for a component that draws
differently per mode. A `DrawComponent` does not set the scene context's
camera, lights, or mode; those belong to the pipeline.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

## Errors

| Condition | Result |
| --- | --- |
| A `tick` or a `draw` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |

## Exports

`RenderMode`, `Renderer`, and `DrawApi` are exported as types, and
`DrawComponent` as an abstract class, from `@test-cabinet/structured-3d`. The
render components the pipeline draws are exported from the same specifier and
listed on the [components](/engines/structured-3d/apis/components/) page.
