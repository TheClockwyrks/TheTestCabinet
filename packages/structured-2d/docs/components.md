# Components

A component is a unit of appearance or behavior attached to exactly one actor
for its lifetime. An actor composes what it looks like, what shape it collides
with, and what it does each frame out of components, and the engine walks them:
enabled components tick in attachment order after their actor, and enabled,
visible render components are collected by the rendering pipeline every frame.

## `Component`

```ts
type ComponentClass<C extends Component = Component> = new (...args: never[]) => C;

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

A component is constructed with whatever arguments its own class takes, then
handed to `actor.attach`. `ComponentClass` is the type `actor.component` and
`actor.componentsOf` select by.

Behavior that belongs to a piece rather than to the whole actor goes in a
component of the game's own:

```ts
import { Component } from "@test-cabinet/structured-2d";

export class Bob extends Component {
  private elapsed = 0;

  constructor(
    private readonly amplitude: number,
    private readonly period: number,
  ) {
    super();
  }

  override tick(dt: number): void {
    this.elapsed += dt;
    const phase = (this.elapsed / this.period) * Math.PI * 2;
    this.offset.y = Math.sin(phase) * this.amplitude;
  }
}
```

Writing `offset` moves the component relative to its actor, so a pickup bobs
while its actor stays where the level placed it.

## `RenderComponent`

```ts
class RenderComponent extends Component {
  layer: number;
  visible: boolean;
  opacity: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `layer` | `0` | Orders the pipeline. Lower layers draw first. |
| `visible` | `true` | Whether the pipeline collects the component. |
| `opacity` | `1` | Clamped to `0..1`. |

`RenderComponent` is the base every drawing component extends. The pipeline
sorts the collection by `layer` ascending, then by the owning actor's spawn
order, then by attachment order, and the sort is stable. See `rendering.md`.

`visible` takes a component out of the picture and leaves it ticking. The
component's own `enabled` is the wider switch: a disabled component skips its
tick, draws nothing, and takes no part in collision.

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
through the asset loader before the component is constructed — a level's `load`
is awaited before any of its actors exist — so a sprite reads its bitmap as a
plain value. See `assets.md`.

The image is sampled as `EngineOptions.imageSmoothing` states: bilinearly by
default, nearest-neighbor when it is `false`. See `rendering.md`.

A sheet is one image with a `source` region selecting the frame, and the region
is a field the actor writes:

```ts
private elapsed = 0;

override tick(dt: number): void {
  this.elapsed += dt;
  const frame = Math.floor(this.elapsed * 12) % 4;
  this.sprite.source = { x: frame * 16, y: 0, width: 16, height: 16 };
}
```

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

A component with neither a fill nor a stroke draws nothing, so set at least one.

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

The font size is world units, scaled by the camera like every other drawn
quantity. A scoreboard that shows live figures writes `text` from a tick:

```ts
export class Scoreboard extends Actor {
  readonly label: TextComponent;

  constructor() {
    super();
    this.label = this.attach(
      new TextComponent({ text: "0 - 0", font: "24px monospace" }),
    );
    this.label.layer = LAYER.hud;
  }

  override tick(): void {
    const scores = this.world.state.players.map((player) => player.score);
    this.label.text = scores.join(" - ");
  }
}
```

## `DrawComponent`

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

`DrawComponent` is the direct-drawing path, for a picture the built-in
components cannot state. The engine calls `draw` in the component's place in the
layer order, with the context already carrying the world-to-device transform, so
the component draws in world units. Render modes belong to the declarative
pipeline, so a `DrawComponent` reads `api.mode` and supplies its own. See
`rendering.md` for a worked example.

## `CameraComponent`

```ts
class CameraComponent extends Component {
  constructor(options?: { zoom?: number });
  zoom: number;
}
```

An actor carrying a `CameraComponent` is a view target. The world's camera
follows the first enabled one its target holds, at that component's world
transform and zoom. See `camera.md`.

## `ColliderComponent`

A `ColliderComponent` gives its actor a shape the engine tests, positioned by
the component's world transform. Its options, its channel and response fields,
the manifold a blocking pair reports, and the queries a game runs against the
collision world are specified in `collision.md`.

## Errors

| Condition | Result |
| --- | --- |
| A `beginPlay` throws while the start level is built | `engine.initialize` rejects with the cause |
| A `tick` or a `draw` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
