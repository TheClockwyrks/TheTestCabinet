---
title: Camera and Viewport
---

A game places its actors in world units. The camera's frustum projects the
world into the logical design size handed to `createEngine`, and the viewport
maps that logical field onto the canvas's backing store. Every screen-space
position — the pointer, a projected point — is in logical coordinates.

## The three spaces

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units, y-up, right-handed | The game, on every transform |
| Logical | The design size handed to `createEngine`, y-down | The camera's projection |
| Device | Device pixels | The viewport |

The camera carries the first mapping: `projectPoint` takes a world point
through the camera's view and perspective projection into logical coordinates.
The viewport carries the second, with two linear equations:

```ts
deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;
```

The device pair inverts as `(deviceX - offsetX) / scale`, so a pixel read off
the backing store maps back to a logical point, and `pointerRay` carries a
logical point on into the world.

## The world's conventions

The world is right-handed, +Y up, +X right. A camera looks down its local −Z.
Front faces wind counter-clockwise. Angles are radians everywhere: rotations
and field of view. World units are the game's own: a world unit means whatever
the game decides, and every rule a game states is stated in world units.

The logical field keeps the 2D convention: origin top-left, x right, y down,
in logical units. World space is y-up, and the flip between the two lives in
the projection's NDC step and nowhere else.

## `Vec2`, `Vec3`, `Quat`, and `Box3`

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

interface Box3 {
  min: Vec3;
  max: Vec3;
}
```

`Vec2` is a point in the logical field. `Vec3` is a point or a direction in
world units. `Quat` is the orientation representation: identity is
`{ x: 0, y: 0, z: 0, w: 1 }`, and a readable rotation is built with
`quatFromAxisAngle`. There is no Euler type. `Box3` is the axis-aligned box:
a [collider's](/engines/structured-3d/apis/collision/) `bounds()` and a
[`MeshHandle`](/engines/structured-3d/apis/assets/)'s `bounds` are one.

The math functions that operate on these types are the vocabulary
[Simple 3D specifies](/engines/simple-3d/apis/viewport/), shared with the same
names and the same behavior: `vec3Add`, `vec3Sub`, `vec3Scale`, `vec3Dot`,
`vec3Cross`, `vec3Length`, `vec3Normalize`, `quatFromAxisAngle`,
`quatMultiply`, `rotateVec3`, and `transformPoint`, each pure over plain data.

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
`width / height` from
[`EngineOptions`](/engines/structured-3d/apis/engine/), and the horizontal
field of view follows from `fovY` and that aspect. The picture is therefore
identical on every canvas, letterboxed by the viewport exactly as a 2D picture
is, which is what keeps a validator's fixed surface mapping to known pixels.

`CameraState` is a plain value the caller owns. `camera.snapshot()` returns
one, a `DrawComponent` reads one from `api.camera()`, and a
[recording](/engines/structured-3d/apis/recording/) carries one in each
frame's inherited state.

## `Camera`

```ts
interface Camera {
  position: Vec3;
  rotation: Quat;
  fovY: number;
  near: number;
  far: number;
  readonly target: Actor | null;
  follow(actor: Actor | null): void;
  lookAt(point: Vec3): void;
  snapshot(): CameraState;
  project(point: Vec3): Vec2 | null;
  ray(point: Vec2): Ray;
}
```

| Member | Meaning |
| --- | --- |
| `position` | The camera's position in world units. Default `(0, 0, 10)`. |
| `rotation` | The camera's orientation. Identity looks down −Z with +Y up. |
| `fovY` | The vertical field of view, in radians. Default `Math.PI / 3`. Between `0` and `π`, exclusive. |
| `near` | The near plane distance, in world units. Finite and positive. Default `0.1`. |
| `far` | The far plane distance. Greater than `near`. Default `1000`. |
| `target` | The actor the camera follows, or `null`. |
| `follow` | Sets `target`. `null` clears it and returns the framing to the game. |
| `lookAt` | Sets `rotation` to aim −Z from `position` at `point`, holding +Y as close to the world's +Y as the aim allows. |
| `snapshot` | The projection as a `CameraState` the caller owns. |
| `project` | `projectPoint(snapshot(), engine.viewport(), point)`: the world point in logical coordinates, or `null` at or behind the camera plane. |
| `ray` | `pointerRay(snapshot(), engine.viewport(), point)`: the picking ray through a logical point. |

The camera is reached as `world.camera` and is part of the world, so a level
transition builds a new one at the defaults. `lookAt` with `point` equal to
`position` leaves `rotation` unchanged, and an aim parallel to the world's y
axis holds +Z as up instead.

There is no zoom and no bounds: framing is `position`, `rotation`, and `fovY`,
so "closer" is moving the camera or narrowing `fovY`, and a frustum has no 2D
clamp rectangle. A game that confines its framing writes the confinement into
the code that moves the camera.

## Following a view target

An actor is a view target by carrying a
[`CameraComponent`](/engines/structured-3d/apis/components/). `follow(actor)`
sets `target`. Each frame, before the pipeline draws, the engine writes
`position`, `rotation`, and `fovY` from the target's first enabled
`CameraComponent`, adopting that component's world position and rotation and
its `fovY`; `near` and `far` stay as set.

`follow(null)` clears the target, and the game writes `position`, `rotation`,
and `fovY` itself.

## `Ray`, `projectPoint`, and `pointerRay`

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

Both functions are pure, and they are the whole projection contract: every
mapping the engine performs is a composition of these with the viewport
equations. Normalized device coordinates sit between the two spaces:

```ts
ndcX = 2 * logicalX / width - 1;
ndcY = 1 - 2 * logicalY / height;
```

The y flip lives here and nowhere else.

`projectPoint` maps a world point through the camera's view and perspective
projection into logical coordinates. A point at or behind the camera plane
returns `null`. A visible point maps into `0..width` × `0..height`; a point
outside the frustum maps outside that range and is returned as-is.

`pointerRay` is the picking convention: `origin` is the camera's position, and
`direction` is the unit vector through the given logical point on the near
plane. A point inside a letterbox bar is outside `0..width`/`0..height` and
still yields a ray, since the math extends past the field's edge; treating it
as a miss is the game's choice. For a point in front of the camera,
`pointerRay(c, v, projectPoint(c, v, p))` passes through `p`.

A validator computes the device pixel a world point drew into as
`projectPoint` followed by the two viewport equations, so a fixed design size
and a scripted camera resolve a world position to an exact pixel.

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

## Mapping onto the canvas

The renderer maps the logical field onto the letterboxed device rectangle
itself: its device viewport and scissor are the fit, and the letterbox bars
are cleared outside the picture. The observable contract is the two device
equations above. There is no `applyViewport` in this package: there is no 2D
context to set a transform on.

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
[surface](/engines/structured-3d/apis/engine/) reports, and returns the fit.
The backing store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`,
written only when it differs from the current values, since assigning
`canvas.width` reallocates and clears the canvas.

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

`Vec2`, `Vec3`, `Quat`, `Transform`, `Box3`, `Ray`, `CameraState`, `Camera`,
and `Viewport` are exported as types, and `vec3Add`, `vec3Sub`, `vec3Scale`,
`vec3Dot`, `vec3Cross`, `vec3Length`, `vec3Normalize`, `quatFromAxisAngle`,
`quatMultiply`, `rotateVec3`, `transformPoint`, `projectPoint`, `pointerRay`,
`fitViewport`, and `syncCanvas` as functions, from
`@test-cabinet/structured-3d`. `Transform` is specified on the
[actors](/engines/structured-3d/apis/actors/) page.
