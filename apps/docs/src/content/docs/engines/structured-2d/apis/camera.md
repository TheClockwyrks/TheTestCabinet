---
title: Camera and Viewport
---

A game places its actors in world units. The camera projects a region of the
world into the logical design size handed to `createEngine`, and the viewport
maps that logical field onto the canvas's backing store. The pipeline composes
the two into the transform each render component draws through.

## The three spaces

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units | The game, on every transform |
| Logical | The design size handed to `createEngine` | The camera |
| Device | Device pixels | The viewport |

The camera carries the first mapping and the viewport the second, with `width`
and `height` the logical design size:

```ts
logicalX = width / 2 + (worldX - camera.x) * camera.zoom;
logicalY = height / 2 + (worldY - camera.y) * camera.zoom;

deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;
```

The world-to-logical pair holds with `rotation` at `0`. The device pair inverts
as `(deviceX - offsetX) / scale`, so a pixel read off the backing store maps
back to a logical point and then through the camera to a world one.

A render component in `screen` space skips the first map: its composed
transform is logical coordinates, and the viewport alone carries it onto the
canvas. See [rendering](/engines/structured-2d/apis/rendering/).

## `Vec2` and `Rect`

```ts
interface Vec2 {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

`Vec2` is a point or a direction. `Rect` is an axis-aligned rectangle, placed by
`x` and `y` and sized by `width` and `height`. Both carry the units of whatever
names them.

## `CameraSnapshot`

```ts
interface CameraSnapshot {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}
```

The camera's projection at one moment, as a plain value the caller owns.
`camera.snapshot()` returns one, and a `DrawComponent` reads one from
`api.camera()`. A held snapshot keeps the values of the frame it was read in.

## `Camera`

```ts
interface Camera {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  bounds: Rect | null;
  readonly target: Actor | null;
  follow(actor: Actor | null): void;
  snapshot(): CameraSnapshot;
  worldToLogical(point: Vec2): Vec2;
  logicalToWorld(point: Vec2): Vec2;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `x` | `width / 2` | The world x the center of the logical field shows. |
| `y` | `height / 2` | The world y the center of the logical field shows. |
| `zoom` | `1` | Logical units per world unit. |
| `rotation` | `0` | Radians, turning the projected region about the camera's position. |
| `bounds` | `null` | A rectangle in world units the visible region is kept inside. |
| `target` | `null` | The actor the camera follows. |

| Method | Result |
| --- | --- |
| `follow` | Sets `target`. `null` clears it and returns the projection to the game. |
| `snapshot` | The projection as a value the caller owns. |
| `worldToLogical` | A world point in logical coordinates, through position, zoom, and rotation. |
| `logicalToWorld` | The inverse of `worldToLogical`. |

A world's camera starts at `x = width / 2`, `y = height / 2`, `zoom = 1`,
`rotation = 0`, and `bounds = null`, so world coordinates and logical
coordinates coincide until the game moves it. `zoom` is logical units per world
unit: a `zoom` of `2` draws a world unit two logical units wide and halves the
visible extent.

The camera is reached as `world.camera` and is part of the world, so a level
transition builds a new one at those defaults.

## Following a view target

An actor is a view target by carrying a
[`CameraComponent`](/engines/structured-2d/apis/components/). `follow(actor)`
sets `target`. Each frame, before the pipeline draws, a camera with a target
takes the first enabled `CameraComponent` the target holds and adopts that
component's world transform and zoom, then clamps the result to `bounds`.

`follow(null)` clears the target, and the game writes `x`, `y`, `zoom`, and
`rotation` itself.

## Bounds

`bounds` is a rectangle in world units the camera's visible region is kept
inside. With `rotation` at `0` the visible extent is the logical field divided
by the zoom, `width / zoom` by `height / zoom`. Each axis is clamped on its own,
and an axis whose visible extent exceeds the bounds on that axis centers on it.

## `Viewport`

```ts
interface Viewport {
  readonly width: number;
  readonly height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}
```

| Field | Meaning |
| --- | --- |
| `width` | The logical design width. |
| `height` | The logical design height. |
| `scale` | Device pixels per logical unit, with the device pixel ratio folded in. |
| `offsetX` | The left letterbox bar, in device pixels. |
| `offsetY` | The top letterbox bar, in device pixels. |

`scale` and both offsets are device pixels. The CSS-pixel figure is `scale`
divided by the device pixel ratio.

## `fitViewport`

```ts
function fitViewport(
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport;
```

The scale is uniform: the smaller of `cssWidth / logicalWidth` and
`cssHeight / logicalHeight`, multiplied by `dpr`. One scale preserves the aspect
ratio and keeps the whole logical field visible.

The leftover space on the long axis is split into two equal letterbox bars,
which are the offsets. They are computed against the rounded device size the
backing store is written at, so the two bars sum to the drawable area exactly.

A degenerate input yields a `scale` of `0`: a surface measuring zero on either
axis, or a logical size that is not finite and positive. A ratio that is not
finite and positive is read as `1`. A zero scale draws nothing for the frame it
applies to, and the fit recovers on its own once the element has a size.

## `applyViewport`

```ts
function applyViewport(ctx: CanvasRenderingContext2D, viewport: Viewport): void;
```

Sets the context transform to the viewport, as
`setTransform(scale, 0, 0, scale, offsetX, offsetY)`. The transform is replaced
rather than composed, so every frame starts from the viewport whatever state the
previous frame's render left the context in. The pipeline then composes the
camera onto it, which is what lets a render component draw in world units.

## `syncCanvas`

```ts
function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: SurfaceMetrics,
): Viewport;
```

Brings the canvas's backing store in line with the size and ratio the
[surface](/engines/structured-2d/apis/engine/) reports, and returns the fit. The
backing store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`, written
only when it differs from the current values, since assigning `canvas.width`
reallocates and clears the canvas.

A surface reporting zero on either axis leaves the backing store as it stands,
which keeps the last frame drawn on screen, and returns a viewport whose scale
is zero.

## Resynced every frame

The engine recomputes the fit at the top of every frame, from what the surface
reports at that moment, and once when the engine is created so the first read of
`engine.viewport()` reports a real fit. A window resize, a device pixel ratio
change from a display switch, and a layout change that fires no event at all
each correct themselves within one frame.

## Pinning the CSS size

The engine pins a pixel CSS size onto the canvas only while the reported size
still matches the backing-store attributes.

| Measurement | The engine writes |
| --- | --- |
| The reported CSS size equals the size the backing-store attributes imply | `style.width` and `style.height` in pixels, equal to the measurement, alongside the backing store |
| The page sized the element, inline or through a stylesheet | The backing store alone |

An element the page has not sized takes its CSS size from the `width` and
`height` attributes, which are exactly what the backing store writes. Writing
the backing store would then feed into the next measurement, and the element
would grow by the device pixel ratio on every frame. Pinning the measured size
breaks that loop.

## Reading the fit

`engine.viewport()`, `world.viewport()`, `InitApi.viewport()`, and a
`DrawComponent`'s `api.viewport()` all return the current fit. Each call returns
a snapshot the caller owns, so a held viewport keeps the values of the frame it
was read in.

## Exports

`Vec2`, `Rect`, `CameraSnapshot`, `Camera`, and `Viewport` are exported as
types, and `fitViewport`, `applyViewport`, and `syncCanvas` as functions, from
`@test-cabinet/structured-2d`.
