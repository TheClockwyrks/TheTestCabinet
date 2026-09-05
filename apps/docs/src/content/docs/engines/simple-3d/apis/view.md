---
title: View
---

A game places its objects in world units. The camera projects the world onto
the logical design size handed to `createEngine`, and the viewport maps that
logical field onto the canvas's backing store. `View` is the read side of the
camera: the world-space ray through a logical stage point, the logical stage
point a world point draws at, and the camera's pose as a plain value the caller
owns.

## The three spaces

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units | The game, on every scene object |
| Logical | The design size handed to `createEngine` | The camera's projection, at aspect `width / height` |
| Device | Device pixels | The viewport |

The camera carries the first mapping and the viewport the second, with `width`
and `height` the logical design size. A world point goes through the camera's
view and projection matrices into clip space and is divided by `w` into
normalized device coordinates, and those land on the logical field:

```ts
logicalX = (ndcX + 1) / 2 * width;
logicalY = (1 - ndcY) / 2 * height;
depth = ndcZ;

deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;
```

Logical `x` runs rightward and logical `y` runs downward from the top-left of
the design field, as on the [screen layer](/engines/simple-3d/apis/rendering/),
so a projected point is drawn on the screen layer at its own coordinates. The
device pair inverts as `(deviceX - offsetX) / scale`, so a pixel read off the
screen layer maps back to a logical point and then through `ray` to a line in
the world.

## Coordinate conventions

The world is right-handed with `+Y` up, and the camera looks along its local
`-Z`, which is three's convention. Angles in the plain math types are radians,
and `fov` is degrees, which is three's convention as well. A quaternion is
`{x, y, z, w}`, the identity being `{0, 0, 0, 1}`.

## `Vec2`, `Vec3`, `Quat`, `Mat4`

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

type Mat4 = readonly number[];
```

`Vec2` is a point on the logical field. `Vec3` is a point or a direction in the
world, and `Quat` is a rotation as a unit quaternion. `Mat4` is sixteen numbers
in column-major order, as three stores a matrix, so `Mat4[12..14]` is the
translation. Each is plain fields with no methods, so a value moves between the
state, the engine, and three's own classes through `set` and `toArray`.

## `Ray`, `Projected`, `Box3`

```ts
interface Ray {
  origin: Vec3;
  direction: Vec3;
}

interface Projected {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

interface Box3 {
  min: Vec3;
  max: Vec3;
}
```

| Field | Meaning |
| --- | --- |
| `Ray.origin` | A world point the ray starts from. |
| `Ray.direction` | The ray's direction in world space, unit length. |
| `Projected.x`, `.y` | The point in logical design coordinates. |
| `Projected.depth` | Normalized device depth in `-1..1`, near to far. |
| `Projected.visible` | Whether the point lies inside the camera's frustum. |
| `Box3.min`, `.max` | The corners of an axis-aligned box in world units. |

A point outside the frustum still reports `x`, `y`, and `depth`, and a point
behind the camera reports `visible: false`.

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
| `projection` | Which projection the camera is. |
| `position` | The camera's world position. |
| `rotation` | The camera's world rotation. |
| `fov` | The vertical field of view in degrees. Perspective only, `0` for an orthographic camera. |
| `near`, `far` | The clipping planes, in world units along the view direction. |
| `zoom` | The camera's zoom factor. |
| `left`, `right`, `top`, `bottom` | The orthographic extents, in world units. Orthographic only, `0` for a perspective camera. |

The camera's pose and projection at one moment, as a plain value the caller
owns. `view().camera()` returns one, and a held snapshot keeps the values of
the reading it was taken from.

## Camera defaults

| Field | Perspective | Orthographic |
| --- | --- | --- |
| `position` | `(0, 0, 10)` | `(0, 0, 10)` |
| `rotation` | Identity, looking along `-Z` with `+Y` up | Identity, looking along `-Z` with `+Y` up |
| `fov` | `60` | `0` |
| `near` | `0.1` | `0.1` |
| `far` | `1000` | `1000` |
| `zoom` | `1` | `1` |
| `left`, `right` | `0`, `0` | `-width / 2`, `width / 2` |
| `top`, `bottom` | `0`, `0` | `height / 2`, `-height / 2` |

The projection is chosen by
[`EngineOptions.projection`](/engines/simple-3d/apis/engine/) and the camera
starts at that column's values. At the orthographic defaults a world unit on
the `z = 0` plane is one logical unit, with the world origin at the center of
the design field and world `+Y` pointing up the screen.

## `View`

```ts
interface View {
  camera(): CameraSnapshot;
  ray(x: number, y: number): Ray;
  project(point: Vec3): Projected;
}
```

| Method | Result |
| --- | --- |
| `camera` | The camera's pose and projection as a value the caller owns. |
| `ray` | A world-space ray through the logical stage point `(x, y)`. |
| `project` | The logical stage point a world point draws at, with its depth and whether it is in view. |

`ray` is what picking reads. Through a perspective camera the ray starts at the
camera's position and points through the stage point; through an orthographic
camera it starts at the stage point on the near plane and points along the
camera's view direction. The [pointer](/engines/simple-3d/apis/input/) arrives
in logical stage coordinates, so its position goes straight in:

```ts
update(state, api, dt) {
  const pointer = api.input.pointer();
  const ray = api.view().ray(pointer.x, pointer.y);
  const t = -ray.origin.y / ray.direction.y;
  const ground = {
    x: ray.origin.x + ray.direction.x * t,
    z: ray.origin.z + ray.direction.z * t,
  };
  return { ...state, target: ground };
}
```

`project` is what a readout anchored to a world point reads. The screen layer
draws in the same logical coordinates `Projected` reports, so the point is used
as it stands:

```ts
render(state, api) {
  const label = api
    .view()
    .project({ x: state.hook.x, y: state.hook.y + 1, z: state.hook.z });
  if (label.visible) {
    api.screen.fillText("hook", label.x, label.y);
  }
}
```

## As it stood at the most recent render

`View` reflects the camera as it stood at the most recent render. The engine
reads the camera's world and projection matrices after each `render`, and every
`view()` answers from that reading until the next render. Before the first
render it answers from the camera defaults.

`update` therefore picks against the camera the player is looking through, the
one the previous frame drew, and `render` reads the previous frame's view. A
camera the game poses from `render` on one frame is the camera `ray` and
`project` answer for on the next, and a camera that is still answers the same
on both.

## Reading the view

`engine.view()`, `UpdateApi.view()`, and `RenderApi.view()` return the same
`View`. Each `camera()` call returns a snapshot the caller owns, and each `ray`
and `project` result is a fresh value, so nothing a caller holds is written by
a later render.

## Exports

`Vec2`, `Vec3`, `Quat`, `Mat4`, `Ray`, `Projected`, `Box3`, `CameraSnapshot`,
and `View` are exported as types from `@clockwyrks/simple-3d`.
