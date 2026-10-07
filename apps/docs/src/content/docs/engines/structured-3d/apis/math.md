---
title: Math
---

The engine's spatial types are plain records with fields and no methods, and
the helpers over them are pure functions: every helper returns a fresh value and
mutates nothing. A game reads and writes the fields directly, and imports
`three` where it wants a class. The records are the currency of every transform,
camera, collider, and query in the engine.

## Conventions

The world is right-handed with `+Y` up. A camera and a light look along their
local `-Z`, and `+X` is to their right. Angles in the helpers are radians; the
camera's `fov` alone is degrees. A rotation is a unit quaternion written
`{ x, y, z, w }`, and a matrix is column-major, as three stores both.

## `Vec2` and `Vec3`

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
```

`Vec3` is a point or a direction in the world. `Vec2` is a point on the logical
field: a screen-space shape's vertex, or the logical point handed to
`camera.logicalToRay`. Both carry the units of whatever names them.

## `Rect`

```ts
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

`Rect` is an axis-aligned rectangle on the logical field or in an image, placed
by `x` and `y` and sized by `width` and `height`. A `SpriteComponent`'s
`source` region is one, in the image's pixels.

## `Quat`

```ts
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
```

A rotation, as a unit quaternion. Every helper that takes a `Quat` reads it as
unit length, and every helper that returns one returns unit length.

## `Mat4`

```ts
type Mat4 = readonly number[];
```

Sixteen entries in column-major order, exactly the layout of a three
`Matrix4`'s `elements`. `new THREE.Matrix4().fromArray(m)` reads one and
`matrix.toArray()` writes one.

```ts
import * as THREE from "three";
import type { Component } from "@clockwyrks/structured-3d";

function matrixOf(component: Component): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(component.worldMatrix());
}
```

## `Box3`

```ts
interface Box3 {
  min: Vec3;
  max: Vec3;
}
```

An axis-aligned box in world units, holding every point whose coordinates lie
between `min` and `max` on each axis. A collider's `bounds()` returns one and
the camera's `bounds` takes one.

## `Transform`

```ts
interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}
```

| Field      | Identity                     | Meaning                         |
| ---------- | ---------------------------- | ------------------------------- |
| `position` | `{ x: 0, y: 0, z: 0 }`       | Translation, in world units.    |
| `rotation` | `{ x: 0, y: 0, z: 0, w: 1 }` | Orientation, a unit quaternion. |
| `scale`    | `{ x: 1, y: 1, z: 1 }`       | Scale along each local axis.    |

A `Partial<Transform>` on an `ActorSpec` or a `SpawnSpec` fills its absent
fields from the identity, and a field given is given whole. An
[actor's](/engines/structured-3d/apis/actors/) `transform` and a
[component's](/engines/structured-3d/apis/components/) `offset` are plain
mutable records, so movement is an assignment to a field.

A transform places a point by scaling it, then rotating it, then translating
it, which is the order three composes a matrix from the same three parts. A
component's `worldTransform()` is `composeTransforms(actor.transform, offset)`,
a fresh record, and its `worldMatrix()` is `transformToMatrix` of that record.

```ts
import {
  FORWARD,
  Pawn,
  add,
  quatFromEuler,
  quatRotate,
  scale,
} from "@clockwyrks/structured-3d";

class Ship extends Pawn {
  yaw = 0;
  speed = 4;

  override tick(dt: number): void {
    this.transform.rotation = quatFromEuler(0, this.yaw, 0);
    const heading = quatRotate(this.transform.rotation, FORWARD);
    this.transform.position = add(
      this.transform.position,
      scale(heading, this.speed * dt),
    );
  }
}
```

## Constants

| Constant        | Value                        |
| --------------- | ---------------------------- |
| `VEC3_ZERO`     | `{ x: 0, y: 0, z: 0 }`       |
| `VEC3_ONE`      | `{ x: 1, y: 1, z: 1 }`       |
| `UP`            | `{ x: 0, y: 1, z: 0 }`       |
| `FORWARD`       | `{ x: 0, y: 0, z: -1 }`      |
| `RIGHT`         | `{ x: 1, y: 0, z: 0 }`       |
| `QUAT_IDENTITY` | `{ x: 0, y: 0, z: 0, w: 1 }` |

Each constant is one frozen record shared by every reader. A field that is
written later takes a fresh value, `vec3(0, 0, 0)`, in its place.

## Vector helpers

```ts
function vec3(x: number, y: number, z: number): Vec3;
function add(a: Vec3, b: Vec3): Vec3;
function sub(a: Vec3, b: Vec3): Vec3;
function scale(v: Vec3, s: number): Vec3;
function dot(a: Vec3, b: Vec3): number;
function cross(a: Vec3, b: Vec3): Vec3;
function length(v: Vec3): number;
function normalize(v: Vec3): Vec3;
function distance(a: Vec3, b: Vec3): number;
function lerp(a: Vec3, b: Vec3, t: number): Vec3;
```

| Helper           | Result                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `vec3(x, y, z)`  | A fresh vector.                                                    |
| `add(a, b)`      | `a + b`, per component.                                            |
| `sub(a, b)`      | `a - b`, per component.                                            |
| `scale(v, s)`    | `v` with every component multiplied by `s`.                        |
| `dot(a, b)`      | The dot product.                                                   |
| `cross(a, b)`    | The cross product `a × b`, right-handed.                           |
| `length(v)`      | The Euclidean length.                                              |
| `normalize(v)`   | `v` at unit length. The zero vector normalizes to the zero vector. |
| `distance(a, b)` | `length(sub(b, a))`.                                               |
| `lerp(a, b, t)`  | `a + (b - a) * t`, per component, with `t` unclamped.              |

## Quaternion helpers

```ts
function quat(x: number, y: number, z: number, w: number): Quat;
function quatFromEuler(x: number, y: number, z: number): Quat;
function quatToEuler(q: Quat): Vec3;
function quatFromAxisAngle(axis: Vec3, angle: number): Quat;
function quatMultiply(a: Quat, b: Quat): Quat;
function quatInverse(q: Quat): Quat;
function quatRotate(q: Quat, v: Vec3): Vec3;
function quatSlerp(a: Quat, b: Quat, t: number): Quat;
function quatLookAt(forward: Vec3, up?: Vec3): Quat;
```

| Helper                           | Result                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quat(x, y, z, w)`               | A fresh quaternion from its components.                                                                                                                                                       |
| `quatFromEuler(x, y, z)`         | The rotation of `x` radians about X, `y` about Y, and `z` about Z, applied in the YXZ order below.                                                                                            |
| `quatToEuler(q)`                 | The Euler angles, `{ x: pitch, y: yaw, z: roll }`, that `quatFromEuler` turns back into `q`, with pitch in `-π/2..π/2`.                                                                       |
| `quatFromAxisAngle(axis, angle)` | The rotation of `angle` radians about the unit vector `axis`, counterclockwise when looking down the axis toward the origin.                                                                  |
| `quatMultiply(a, b)`             | The Hamilton product `a · b`.                                                                                                                                                                 |
| `quatInverse(q)`                 | The rotation undoing `q`; for a unit quaternion, its conjugate.                                                                                                                               |
| `quatRotate(q, v)`               | `v` turned by `q`.                                                                                                                                                                            |
| `quatSlerp(a, b, t)`             | The spherical interpolation from `a` at `t = 0` to `b` at `t = 1`, along the shorter arc.                                                                                                     |
| `quatLookAt(forward, up)`        | The rotation taking `FORWARD` onto `normalize(forward)`, rolled so its local `+Y` lies as near `up` as the direction allows. `up` defaults to `UP`, and a zero `forward` yields the identity. |

### Euler angles

`quatFromEuler(x, y, z)` composes yaw about Y, then pitch about X, then roll
about Z, in the body's own axes:

```ts
const qy = quatFromAxisAngle(UP, y);
const qx = quatFromAxisAngle(RIGHT, x);
const qz = quatFromAxisAngle(vec3(0, 0, 1), z);
const q = quatMultiply(quatMultiply(qy, qx), qz);
```

That is three's `Euler` order `"YXZ"`, so `new THREE.Euler(x, y, z, "YXZ")`
and `quatFromEuler(x, y, z)` describe one rotation. A yaw alone,
`quatFromEuler(0, yaw, 0)`, turns about the world's up axis, and a heading is
read back as `quatToEuler(q).y`.

### The product order

`quatMultiply(a, b)` is the Hamilton product `a · b`, matching three's
`Quaternion.multiply`. Rotating a vector by the product applies `b` first and
`a` second:

```ts
quatRotate(quatMultiply(a, b), v) === quatRotate(a, quatRotate(b, v));
```

A rotation `r` added in world axes therefore goes on the left,
`quatMultiply(r, q)`, and a rotation added in the body's own axes goes on the
right, `quatMultiply(q, r)`.

## Transform helpers

```ts
function composeTransforms(parent: Transform, child: Transform): Transform;
function transformPoint(t: Transform, p: Vec3): Vec3;
function transformToMatrix(t: Transform): Mat4;
```

| Helper                             | Result                                                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composeTransforms(parent, child)` | The transform of `child` placed inside `parent`: `position` is `transformPoint(parent, child.position)`, `rotation` is `quatMultiply(parent.rotation, child.rotation)`, and `scale` is the per-component product of the two scales. |
| `transformPoint(t, p)`             | `p` scaled by `t.scale` per component, then rotated by `t.rotation`, then translated by `t.position`.                                                                                                                               |
| `transformToMatrix(t)`             | The column-major matrix three's `Matrix4.compose(position, quaternion, scale)` builds from the same three parts. Applying it to a point gives `transformPoint(t, p)`.                                                               |

`composeTransforms` is the composition `worldTransform()` performs, with the
actor's transform as `parent` and the component's `offset` as `child`. A
scale is carried per component, so the composition is exact under a uniform
scale and treats a non-uniform parent scale as acting along the child's axes.

## Exports

`Vec2`, `Vec3`, `Rect`, `Quat`, `Mat4`, `Box3`, and `Transform` are exported
as types,
`VEC3_ZERO`, `VEC3_ONE`, `UP`, `FORWARD`, `RIGHT`, and `QUAT_IDENTITY` as
values, and every helper above as a function, from
`@clockwyrks/structured-3d`.
