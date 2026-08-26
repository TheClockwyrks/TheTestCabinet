---
title: Viewport
---

A game simulates in world units of its own and is projected into the logical
design size it declared to `createEngine`. This page specifies the math
vocabulary that world is written in, the viewport that fits the logical field
onto the canvas's backing store, and the frustum camera with the two projection
functions that connect the three.

## Coordinate conventions

The world is a **right-handed** coordinate system with **+Y up** and +X right.
A camera looks down its **local −Z**, and front faces wind counter-clockwise.
World units are the game's own: a world unit means whatever the game decides,
and every rule a game states is stated in world units. Angles are radians,
everywhere: rotations and field of view alike.

The logical design field keeps the 2D convention: origin top-left, x right,
**y down**, in logical units. World space is y-up; the camera's projection is
the one place the flip happens. This is what lets the pointer, the viewport,
the overlay, and the recording metadata carry over from the 2D engines
unchanged.

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units, y-up, right-handed | The game |
| Logical | The design size handed to `createEngine`, y-down | The camera's projection |
| Device | Device pixels | The viewport |

## Math types

```ts
interface Vec2 {
  x: number;
  y: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

interface Box3 {
  min: Vec3;
  max: Vec3;
}
```

`Vec2` is a point in the logical field: a pointer position, a projected point.
`Quat` is the orientation representation; there is no Euler type, and a
readable rotation is built with `quatFromAxisAngle`. Identity is
`{ x: 0, y: 0, z: 0, w: 1 }`, and quaternions are kept unit-length by the
functions that produce them.

`Transform` composes scale, then rotation, then translation. Identity is
position `(0, 0, 0)`, identity rotation, scale `(1, 1, 1)`. `Box3` is the
axis-aligned box.

## Math functions

```ts
function vec3Add(a: Vec3, b: Vec3): Vec3;
function vec3Sub(a: Vec3, b: Vec3): Vec3;
function vec3Scale(v: Vec3, s: number): Vec3;
function vec3Dot(a: Vec3, b: Vec3): number;
function vec3Cross(a: Vec3, b: Vec3): Vec3;
function vec3Length(v: Vec3): number;
function vec3Normalize(v: Vec3): Vec3;
function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat;
function quatMultiply(a: Quat, b: Quat): Quat;
function rotateVec3(q: Quat, v: Vec3): Vec3;
function transformPoint(t: Transform, p: Vec3): Vec3;
```

Each is pure over plain data: no classes, no methods, no mutation, and every
function returns a fresh value.

| Function | Behavior |
| --- | --- |
| `vec3Normalize` | The unit vector. A zero vector returns `(0, 0, 0)`. |
| `quatFromAxisAngle` | The rotation of `angleRad` about `axis`. The axis is normalized; a zero axis yields identity. |
| `quatMultiply` | `quatMultiply(a, b)` applies `b` first, then `a`. |
| `rotateVec3` | `v` rotated by `q`. |
| `transformPoint` | `p` under `t`: scale, then rotation, then translation. |

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
| `width` | The logical design width. The picture is projected into `0..width`. |
| `height` | The logical design height. The picture is projected into `0..height`. |
| `scale` | Device pixels per logical unit, with the device pixel ratio folded in. |
| `offsetX` | The left letterbox bar, in device pixels. |
| `offsetY` | The top letterbox bar, in device pixels. |

`scale` and both offsets are device pixels. The CSS-pixel figure is `scale`
divided by the device pixel ratio. The viewport is recomputed at the top of
every frame from the size and device pixel ratio the
[surface](/engines/simple-3d/apis/engine/) reports.

## The mapping

```ts
deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;

logicalX = (deviceX - offsetX) / scale;
logicalY = (deviceY - offsetY) / scale;
```

There is no `applyViewport` and no transform to set: the renderer itself maps
the logical field onto the letterboxed device rectangle — its device viewport
and scissor are the fit — and clears the letterbox bars outside the picture.
The observable contract is the two equations above.

The backing store is addressed in device pixels, so a validator computes the
device pixel a world point drew into as [`projectPoint`](#projectpoint) into
logical coordinates, then the first pair of equations. A validator that pins
the surface to a known size and ratio therefore knows the exact pixel to
sample.

A pointer event reports its position in CSS pixels relative to the element, so
it multiplies by the device pixel ratio before the inverse map:
`(cssX * dpr - offsetX) / scale`. This is the map the engine's own
[pointer input](/engines/simple-3d/apis/input/) applies, so a game reads
positions already converted.

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
`cssHeight / logicalHeight`, multiplied by `dpr`. A single scale preserves the
aspect ratio and keeps the whole logical field visible.

The leftover space on the long axis is split into two equal bars, which are the
offsets. They are computed against the rounded device size the backing store is
written at, so the two bars sum to the drawable area exactly and neither edge
carries a sub-pixel seam.

A degenerate input yields a `scale` of `0` and offsets derived from it: a
container measuring zero on either axis, or a logical size that is not finite
and positive. A ratio that is not finite and positive is read as `1`. A zero
scale draws nothing for the frame it applies to, and the fit recovers on its own
once the element has a size.

## `syncCanvas`

```ts
function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: SurfaceMetrics,
): Viewport;
```

Brings the canvas's backing store in line with the size and ratio the surface
reports, and returns the fit. The engine calls it at the top of every frame, and
once during construction so the first read of `viewport()` and the game's
`initialize` see a real fit.

The backing store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`,
written only when it differs from the current values, since assigning
`canvas.width` reallocates and clears the canvas.

A surface reporting zero on either axis leaves the backing store as it stands,
which keeps the last good frame on screen, and returns a viewport whose scale is
zero.

## Pinning the CSS size

The engine pins a pixel CSS size onto the canvas only when the page has
expressed none.

An element the page has not sized takes its CSS size from the `width` and
`height` attributes, which are exactly what the backing store writes. Writing
the backing store then feeds into the next measurement, and the element grows by
the device pixel ratio on every frame. Pinning the measured size breaks that
loop.

| Measurement | The engine writes |
| --- | --- |
| The reported CSS size equals the size the backing-store attributes imply | `style.width` and `style.height` in pixels, equal to the measurement, alongside the backing store |
| The page sized the element, inline or through a stylesheet | The backing store alone |

A canvas styled to follow its container therefore keeps following it at whatever
size the container currently has, and a canvas dropped into a page that styles
nothing settles at its declared attribute size. A canvas that exposes no style,
such as one driven headlessly behind a supplied surface, keeps the size the
surface reports.

## Measuring through the surface

Every figure the fit is computed from arrives through
[`SurfaceMetrics`](/engines/simple-3d/apis/engine/): `cssWidth()`, `cssHeight()`,
and `dpr()`. The default surface reads the canvas's `clientWidth`,
`clientHeight`, and the owning window's `devicePixelRatio`, so a canvas inside an
iframe is sized by the ratio of the display it is actually on.

A supplied surface replaces every one of those measurements. Fixed figures give
a fixed fit, which is what lets the engine run over a canvas with no document
behind it and gives a validator the same transform on every machine.

## `CameraState`

```ts
interface CameraState {
  position: Vec3;
  rotation: Quat;
  fovY: number;
  near: number;
  far: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `position` | `(0, 0, 10)` | The camera's position in world units. |
| `rotation` | identity | The camera's orientation. Identity looks down −Z with +Y up. |
| `fovY` | `Math.PI / 3` | The vertical field of view, in radians. |
| `near` | `0.1` | The near plane distance, in world units. Finite and positive. |
| `far` | `1000` | The far plane distance, in world units. Greater than `near`. |

Aspect is not a field. The frustum's aspect ratio is always the design aspect,
`width / height` from `EngineOptions`, and the horizontal field of view follows
from `fovY` and that aspect. The picture is therefore identical on every
canvas, letterboxed by the viewport exactly as a 2D picture is — the 3D analog
of fitting the logical design size, and what keeps a validator's fixed surface
mapping to known pixels.

`CameraState` is a plain value. The game keeps one in its own state and applies
it with [`scene.setCamera`](/engines/simple-3d/apis/game/), and each frame of a
[recording](/engines/simple-3d/apis/recording/) carries the camera it
inherited.

## Projection and picking

```ts
interface Ray {
  origin: Vec3;
  direction: Vec3;
}

function projectPoint(
  camera: CameraState,
  viewport: Viewport,
  point: Vec3,
): Vec2 | null;

function pointerRay(
  camera: CameraState,
  viewport: Viewport,
  point: Vec2,
): Ray;
```

These two pure functions are the whole projection contract: every mapping the
engine performs is defined as compositions of these with the viewport
equations. Normalized device coordinates sit between the two spaces:
`ndcX = 2 * logicalX / width - 1` and `ndcY = 1 - 2 * logicalY / height`. The
y flip lives here and nowhere else.

### `projectPoint`

Maps a world point through the camera's view and perspective projection into
logical coordinates. A point at or behind the camera plane returns `null`. A
visible point maps into `0..width` × `0..height`; a point outside the frustum
maps outside that range and is returned as-is.

### `pointerRay`

The picking convention: `origin` is the camera's position, and `direction` is
the unit vector through the given logical point on the near plane. A point
inside a letterbox bar is outside `0..width`/`0..height` and still yields a
ray, since the math extends past the field's edge; treating it as a miss is the
game's choice.

For a point in front of the camera,
`pointerRay(c, v, projectPoint(c, v, p))` passes through `p`.

### The pointer stays 2D

The engine's [pointer](/engines/simple-3d/apis/input/) is one logical pointer
in logical design coordinates. Mapping a pointer position into the scene is
done by whoever needs it, through `pointerRay`; the engine hands the game no
"3D pointer".

## Reading the viewport

`engine.viewport()` and the `viewport()` on each of `InitApi`, `UpdateApi`, and
`RenderApi` return the current fit. Each call returns a snapshot the caller owns,
so a held viewport keeps the values of the frame it was read in.

## Exports

`Vec2`, `Vec3`, `Quat`, `Transform`, `Box3`, `Ray`, `CameraState`, and
`Viewport` are exported as types, and `vec3Add`, `vec3Sub`, `vec3Scale`,
`vec3Dot`, `vec3Cross`, `vec3Length`, `vec3Normalize`, `quatFromAxisAngle`,
`quatMultiply`, `rotateVec3`, `transformPoint`, `projectPoint`, `pointerRay`,
`fitViewport`, and `syncCanvas` as functions, from `@test-cabinet/simple-3d`.
