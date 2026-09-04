---
title: Components
---

A component is a unit of appearance or behavior attached to exactly one actor
for its lifetime. An actor composes what it looks like, what shape it collides
with, and what it does each frame out of components, and the engine walks them:
enabled components tick in attachment order after their actor, and enabled,
visible render components are collected by the rendering pipeline every frame.

## `ComponentClass`

```ts
type ComponentClass<C extends Component = Component> = new (...args: never[]) => C;
```

A component is constructed with whatever arguments its own class takes, then
handed to `actor.attach`. `ComponentClass` is the type `actor.component` and
`actor.componentsOf` select by.

## `Component`

```ts
class Component {
  readonly actor: Actor;
  readonly world: World;
  readonly offset: Transform;
  enabled: boolean;

  beginPlay(): void;
  tick(dt: number): void;
  endPlay(reason: EndPlayReason): void;
  worldTransform(): Transform;
}
```

| Member | Semantics |
| --- | --- |
| `actor` | The actor the component is attached to. Assigned by `attach`, before `beginPlay`. |
| `world` | The world the owning actor belongs to. |
| `offset` | The component's transform relative to its actor's. Defaults to the identity. |
| `enabled` | Defaults to `true`. A disabled component skips its tick, draws nothing, and takes no part in collision. |
| `beginPlay` | Runs once, after `actor` is assigned. |
| `tick` | Runs once per frame with the frame's delta in seconds, after the owning actor's tick. |
| `endPlay` | Runs once, when the component is detached, when its actor is destroyed, or when the world closes. |
| `worldTransform` | The actor's transform composed with `offset`, as a snapshot the caller owns. |

The identity offset is `{ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }`, so a
component drawn without touching `offset` sits exactly on its actor. The base
class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass overrides
only what it needs.

## `RenderComponent`

```ts
type RenderSpace = "world" | "screen";

class RenderComponent extends Component {
  layer: number;
  visible: boolean;
  opacity: number;
  space: RenderSpace;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `layer` | `0` | Orders the pipeline. Lower layers draw first. |
| `visible` | `true` | Whether the pipeline collects the component. |
| `opacity` | `1` | Clamped to `0..1`. |
| `space` | `"world"` | The space the component draws in. `"screen"` draws through the viewport alone, in logical units. |

`RenderComponent` is the base every drawing component extends. The pipeline
sorts the collection by `layer` ascending, then by the owning actor's spawn
order, then by attachment order, and the sort is stable, so a redraw with no
change reproduces the previous order exactly.

A `world` component draws through the camera and then the viewport, so its
transform, its sizes, and its font size are world units. A `screen` component
draws through the viewport alone: its composed transform, its sizes, and its
font size are logical units measured from the top-left of the design field, so
it holds its place on the canvas whatever the camera does. Every quantity the
tables below state in world units is a logical unit under `screen`. One sort
orders both spaces, so a `screen` component's `layer` places
it among the `world` components. See
[rendering](/engines/structured-2d/apis/rendering/).

## `SpriteComponent`

```ts
interface SpriteOptions {
  image: ImageBitmap;
  source?: Rect;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  tint?: string;
}

class SpriteComponent extends RenderComponent {
  constructor(options: SpriteOptions);
  image: ImageBitmap;
  source: Rect | null;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  tint: string | null;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `image` | — | The decoded bitmap the component draws. |
| `source` | `null` | A region of a sprite sheet. `null` selects the whole image. |
| `width` | The source region's pixel width | The drawn width, in world units. |
| `height` | The source region's pixel height | The drawn height, in world units. |
| `anchorX` | `0.5` | The horizontal anchor, as a fraction of the drawn size. |
| `anchorY` | `0.5` | The vertical anchor, as a fraction of the drawn size. |
| `tint` | `null` | A CSS color the image is tinted with. |

The anchor defaults center the sprite on its transform. An image is loaded
through the [assets](/engines/structured-2d/apis/assets/) loader before the
component is constructed, so a sprite reads its bitmap as a plain value.

The image is sampled as `EngineOptions.imageSmoothing` states: bilinearly by
default, nearest-neighbor when it is `false`. See
[rendering](/engines/structured-2d/apis/rendering/).

## `Shape`

```ts
type Shape =
  | { kind: "rect"; width: number; height: number }
  | { kind: "circle"; radius: number }
  | { kind: "polygon"; points: readonly Vec2[] };
```

A rect and a polygon are centered on the component's transform, and a polygon's
points are world units relative to it. The same type describes a drawn shape and
a collider's shape.

## `ShapeComponent`

```ts
interface ShapeOptions {
  shape: Shape;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

class ShapeComponent extends RenderComponent {
  constructor(options: ShapeOptions);
  shape: Shape;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `shape` | — | The geometry drawn. |
| `fill` | `null` | A CSS color filled inside the shape. |
| `stroke` | `null` | A CSS color stroked around the outline. |
| `strokeWidth` | `1` | The stroke width, in world units. |

A component with neither a fill nor a stroke draws nothing.

## `TextComponent`

```ts
interface TextOptions {
  text: string;
  font?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
}

class TextComponent extends RenderComponent {
  constructor(options: TextOptions);
  text: string;
  font: string;
  fill: string;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `text` | — | The string drawn. |
| `font` | `"16px sans-serif"` | A CSS font shorthand. |
| `fill` | `"#ffffff"` | The fill color. |
| `align` | `"center"` | Horizontal alignment against the component's transform. |
| `baseline` | `"middle"` | Vertical alignment against the component's transform. |

The font size is in the component's space: world units under `world`, scaled
by the camera like every other drawn quantity, and logical units under
`screen`.

## `DrawComponent`

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

| Member | Meaning |
| --- | --- |
| `ctx` | The 2D context, already carrying the transform of the component's `space`. |
| `mode` | The render mode in force for this frame. |
| `space` | The component's space: `world` for the world-to-device transform, `screen` for the viewport alone. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `camera` | The camera's position, zoom, and rotation for this frame. |
| `draw` | Called in the component's place in the layer order. |

`DrawComponent` is the direct-drawing path, for a case that measures the drawing
itself. The context already carries the transform of the component's `space`,
so a `world` component draws in world units and a `screen` component in logical
units. Render modes belong to the declarative pipeline, so a `DrawComponent`
reads `api.mode` and supplies its own.

## `CameraComponent`

```ts
class CameraComponent extends Component {
  constructor(options?: { zoom?: number });
  zoom: number;
}
```

| Field | Meaning |
| --- | --- |
| `zoom` | Logical units per world unit the camera takes while following. |

An actor carrying a `CameraComponent` is a view target. The world's
[camera](/engines/structured-2d/apis/camera/) follows the first enabled one it
holds, at that component's world transform and zoom.

## `ColliderComponent`

A `ColliderComponent` gives its actor a shape the engine tests, positioned by
the component's world transform. Its options, its channel and response fields,
the manifold a blocking pair reports, and the queries a game runs against the
collision world are specified under
[collision](/engines/structured-2d/apis/collision/).

## Errors

| Condition | Result |
| --- | --- |
| A `beginPlay` throws while the start level is built | `engine.initialize` rejects with the cause |
| A `tick` or a `draw` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |

A throw under `run` leaves the loop alive, so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.

## Exports

`Component`, `RenderComponent`, `SpriteComponent`, `ShapeComponent`,
`TextComponent`, `DrawComponent`, `CameraComponent`, and `ColliderComponent` are
exported as classes from `@test-cabinet/structured-2d`. `ComponentClass`,
`RenderSpace`, `SpriteOptions`, `Shape`, `ShapeOptions`, `TextOptions`,
`DrawApi`, `ColliderOptions`, `Vec2`, and `Rect` are exported as types from the
same entry point.
