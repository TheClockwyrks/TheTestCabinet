---
title: Camera and Viewport
---

A game places its actors in world units. The camera projects the world onto the
logical design size handed to `createEngine`, through a perspective or
orthographic projection, and the viewport maps that logical field onto the
canvas's backing store. The pipeline renders the world pass through the camera
and draws the screen pass through the viewport alone.

## The three spaces

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units | The game, on every transform |
| Logical | The design size handed to `createEngine` | The camera |
| Device | Device pixels | The viewport |

The camera carries the first mapping and the viewport the second, with `width`
and `height` the logical design size. A world point passes through the
camera's view matrix (the inverse of its world transform) and its projection
matrix, then the perspective divide, and lands on the logical field:

```ts
// clip = projection · inverse(cameraWorld) · [worldX, worldY, worldZ, 1]
ndcX = clipX / clipW;
ndcY = clipY / clipW;
ndcZ = clipZ / clipW;

logicalX = width / 2 + ndcX * width / 2;
logicalY = height / 2 - ndcY * height / 2;

deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;
```

The projection's aspect is `width / height`. Under `perspective` it is a
frustum with the vertical field of view `fov`, from `near` to `far`. Under
`orthographic` it is the box spanning `orthoHeight` world units vertically and
`orthoHeight * width / height` horizontally, from `near` to `far`. The device
pair inverts as `(deviceX - offsetX) / scale`, so a pixel read off the backing
store maps back to a logical point and then through `logicalToRay` to a line
in the world.

A render component in `screen` space skips the first map: its composed
transform is logical coordinates, and the viewport alone carries it onto the
screen layer. See [rendering](/engines/structured-3d/apis/rendering/).

## `Projected` and `Ray`

```ts
interface Projected {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

interface Ray {
  origin: Vec3;
  direction: Vec3;
}
```

| `Projected` field | Meaning |
| --- | --- |
| `x`, `y` | The logical point the world point draws at. |
| `depth` | Normalized device depth in `-1..1`, near to far. |
| `visible` | Whether the point lies inside the camera's frustum. A point behind the camera reports `false`. |

A `Ray` is a world-space line: `origin` is a point in world units and
`direction` is unit length. `Vec3`, `Quat`, and `Box3` are the plain records the
[math](/engines/structured-3d/apis/math/) page defines.

## `CameraSnapshot`

```ts
interface CameraSnapshot {
  projection: "perspective" | "orthographic";
  position: Vec3;
  rotation: Quat;
  fov: number;
  near: number;
  far: number;
  zoom: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
```

| Field | Meaning |
| --- | --- |
| `projection` | The projection in force. |
| `position` | The camera's world position. |
| `rotation` | The camera's world rotation, a unit quaternion. |
| `fov` | The vertical field of view in degrees under `perspective`, else `0`. |
| `near`, `far` | The clipping planes, in world units from the camera. |
| `zoom` | Three's zoom factor; the world's camera reports `1`. |
| `left`, `right`, `top`, `bottom` | The orthographic extents in world units under `orthographic`, else `0`. |

The camera's projection at one moment, as a plain value the caller owns.
`camera.snapshot()` returns one, and a `DrawComponent` reads one from
`api.camera()`. A held snapshot keeps the values of the frame it was read in.
Under `orthographic`, `top` is `orthoHeight / 2`, `bottom` is `-top`, `right`
is `top * width / height`, and `left` is `-right`.

## `Camera`

```ts
interface Camera {
  position: Vec3;
  rotation: Quat;
  projection: "perspective" | "orthographic";
  fov: number;
  near: number;
  far: number;
  orthoHeight: number;
  bounds: Box3 | null;
  readonly target: Actor | null;
  follow(actor: Actor | null): void;
  lookAt(point: Vec3, up?: Vec3): void;
  snapshot(): CameraSnapshot;
  worldToLogical(point: Vec3): Projected;
  logicalToRay(point: Vec2): Ray;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `position` | `{ x: 0, y: 0, z: 10 }` | The camera's world position. |
| `rotation` | `{ x: 0, y: 0, z: 0, w: 1 }` | The camera's world rotation. The camera looks along its local `-Z` with local `+Y` up. |
| `projection` | `"perspective"` | The projection the world pass renders through. |
| `fov` | `60` | The vertical field of view in degrees, read under `perspective`. |
| `near` | `0.1` | The near clipping plane, in world units from the camera. |
| `far` | `1000` | The far clipping plane, in world units from the camera. |
| `orthoHeight` | The logical design height | The world units the view spans vertically, read under `orthographic`. |
| `bounds` | `null` | A box in world units the camera's position is kept inside. |
| `target` | `null` | The actor the camera follows. |

| Method | Result |
| --- | --- |
| `follow` | Sets `target`. `null` clears it and returns the pose to the game. |
| `lookAt` | Writes `rotation` so the camera looks from `position` toward `point`, with local `+Y` as near `up` as the view allows. `up` defaults to `UP`. |
| `snapshot` | The projection as a value the caller owns. |
| `worldToLogical` | A world point on the logical field, through the camera as it stands at the call. |
| `logicalToRay` | A world-space ray through a logical point, from the camera as it stands at the call. |

A world's camera starts at the defaults above, at `(0, 0, 10)` looking along
`-Z` at the origin, so a mesh at the origin is in view before the game moves
anything. Under `orthographic` at the default `orthoHeight`, one world unit on
the `z = 0` plane is one logical unit, and the logical field's center is the
world origin.

`logicalToRay` answers under `perspective` with `origin` at `position` and
`direction` pointing from it through the logical point on the near plane, and
under `orthographic` with `origin` on the near plane at that point and
`direction` the camera's forward axis. The ray is the line a pointer at that
logical point picks along, and a game hands it to the
[collision](/engines/structured-3d/apis/collision/) raycasts.

The camera is reached as `world.camera` and is part of the world, so a level
transition builds a new one at those defaults.

## Following a view target

An actor is a view target by carrying a
[`CameraComponent`](/engines/structured-3d/apis/components/). `follow(actor)`
sets `target`. Each frame, before the pipeline draws, a camera with a target
takes the first enabled `CameraComponent` the target holds and adopts that
component's world transform, `position` and `rotation`, and its `fov`, then
clamps `position` to `bounds`.

`follow(null)` clears the target, and the game writes `position`, `rotation`,
and `fov` itself.

## Bounds

`bounds` is a box in world units the camera's `position` is kept inside. Each
frame, before the pipeline draws and after a followed target has been adopted,
each axis of `position` is clamped on its own to the box's `min` and `max` on
that axis, and the clamped value is written back to `position`. The projection
is left as it stands, so the clamp moves the camera and changes nothing about
what it sees from where it ends up.

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
previous frame's render left the context in. The pipeline applies it to the
screen layer's context every frame, which is what lets a screen-space component
draw in logical units.

## The viewport in the world pass

The world pass draws through the same fit. Each frame the renderer's viewport
and scissor are set to the letterboxed rectangle, `offsetX`, `offsetY`,
`width * scale` by `height * scale` in device pixels, with the scissor test on.
The whole canvas is cleared to `background` before the scissor is applied, so
the letterbox bars carry the background color, and to transparent when
`background` is absent.

A perspective camera's aspect is held at `width / height` and its projection
matrix is updated every frame, so the picture the renderer draws and the point
`worldToLogical` computes agree. The screen layer is composited over the
letterboxed picture at the end of the frame, pixel for pixel, since both
canvases share one backing-store size.

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
[surface](/engines/structured-3d/apis/engine/) reports, and returns the fit. The
backing store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`, written
only when it differs from the current values, since assigning `canvas.width`
reallocates and clears the canvas.

A surface reporting zero on either axis leaves the backing store as it stands,
which keeps the last frame drawn on screen, and returns a viewport whose scale
is zero.

The engine syncs the stage canvas this way and then sizes the screen layer's
canvas to the same backing store, so the two composite without scaling.

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

`Projected`, `Ray`, `CameraSnapshot`, `Camera`, and `Viewport` are exported as
types, and `fitViewport`, `applyViewport`, and `syncCanvas` as functions, from
`@clockwyrks/structured-3d`.
