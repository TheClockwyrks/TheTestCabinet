# Rendering

The engine owns rendering. A game configures what to draw by attaching render
components to its actors, and the pipeline collects them, orders them, and draws
them once per frame. `components.md` covers what each built-in component draws;
this page covers the pipeline that draws them.

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

Step 3 reads `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either is
cleared. A destroyed actor stops rendering immediately, before the end-of-frame
flush removes it from the world.

Step 5 composes the camera and then the viewport into one transform for a
`world` component, so it states every coordinate, size, and font size in world
units, and applies the viewport alone for a `screen` component, which states
them in logical units. See `camera.md` for both maps.

## The sort

The sort key is `layer` ascending, then the owning actor's spawn order, then
attachment order within that actor. `layer` defaults to `0`, so components a
game leaves at the default draw in spawn order. The sort is stable, so a redraw
with no change reproduces the previous order exactly.

Number the layers in one place, leave gaps between them, and give every
component a layer from that table rather than a literal:

```ts
export const LAYER = { field: 0, actors: 10, effects: 20, hud: 30 } as const;
```

Two components that must overlap in a fixed order belong on two layers, or on
one actor attached in the order they should draw.

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

A HUD is an actor whose components take `screen` space, each offset to its
logical position, on a layer above the field:

```ts
export class Hud extends Actor {
  readonly score: TextComponent;

  constructor() {
    super();
    this.score = this.attach(
      new TextComponent({
        text: "0",
        font: "24px monospace",
        align: "left",
        baseline: "top",
      }),
    );
    this.score.space = "screen";
    this.score.offset.x = 16;
    this.score.offset.y = 12;
    this.score.layer = LAYER.hud;
  }
}
```

## Image smoothing

The viewport fit scales the whole picture, so an image drawn at its pixel size
in world units still covers more or fewer device pixels than it has. How those
device pixels are filled is `EngineOptions.imageSmoothing`. `true`, the
default, resamples bilinearly; `false` samples nearest-neighbor, so each image
pixel becomes a block of device pixels and pixel art stays crisp at every fit.

The pipeline sets the context's `imageSmoothingEnabled` from the option in
step 2 of every frame, before any component draws, so every `SpriteComponent`
blit and the scratch a tinted sprite is flattened on sample the same way, and
a `DrawComponent` receives the context already carrying the setting. The
option is fixed for the engine's lifetime and applies under every render mode
that draws an image.

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
every game has all four modes available without writing anything. Wireframe
shows the geometry a build placed and silhouette shows how it layered that
geometry, so both are worth looking at while the picture is being built.

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
construction, so whoever holds the engine drives both switches:

```ts
engine.renderer.setMode("wireframe");
engine.renderer.setCollisionOverlay(true);
```

The collision overlay draws every enabled collider's shape over the finished
picture, in a color per response, and is independent of the mode. See
`collision.md`.

## Direct drawing

A picture the built-in components cannot state is drawn with a `DrawComponent`.
The engine calls `draw` in the component's place in the layer order, with the
context already carrying the transform of the component's `space`, so a `world`
component draws in world units and a `screen` component in logical units.
Render modes belong to the declarative pipeline, so a `DrawComponent` reads
`api.mode` and supplies its own.

```ts
import { DrawComponent, type DrawApi, type Vec2 } from "@test-cabinet/structured-2d";
import { PALETTE } from "./constants";

export class Trail extends DrawComponent {
  private readonly points: Vec2[] = [];

  override tick(): void {
    const at = this.worldTransform();
    this.points.push({ x: at.x, y: at.y });
    if (this.points.length > 48) this.points.shift();
  }

  draw(api: DrawApi): void {
    if (this.points.length < 2) return;
    const { ctx } = api;

    ctx.save();
    ctx.beginPath();
    this.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    if (api.mode === "wireframe") {
      ctx.lineWidth = 1;
      ctx.strokeStyle = PALETTE.hud;
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = PALETTE.trail;
      ctx.globalAlpha = api.mode === "shaded" ? this.opacity : 1;
    }

    ctx.stroke();
    ctx.restore();
  }
}
```

Attach it like any other render component, and give it a layer. Balance `save`
and `restore` around a transformed or restyled subtree, so the components drawn
after it start from the transform and the styles the pipeline handed over. The
context arrives with image smoothing set from `imageSmoothing`, so an image a
`DrawComponent` draws samples the way a sprite does.

`DrawApi` also carries `space` (the component's space, naming the transform the
context arrived under), `frame()` (the frame counter, the accumulated simulated
time, and the most recent delta), `viewport()` (the current logical-to-device
fit), and `camera()` (the camera's position, zoom, and rotation for this frame),
the last three each as a snapshot the caller owns.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline, so the simulation is examinable
independently of any drawing surface.
