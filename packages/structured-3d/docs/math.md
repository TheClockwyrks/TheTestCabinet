# Math

The engine's spatial types are plain records with fields and no methods, and the
helpers over them are pure functions: every helper returns a fresh value and
mutates nothing. A game reads and writes the fields directly, and imports
`three` where it wants a class. The records are the currency of every transform,
camera, collider, and query in the engine.

## Conventions

The world is right-handed with `+Y` up. A camera and a light look along their
local `-Z`, and `+X` is to their right. Angles in the helpers are radians; the
camera's `fov` alone is degrees. A rotation is a unit quaternion written
`{ x, y, z, w }`, and a matrix is column-major, as three stores both.

## The types

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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box3 {
  min: Vec3;
  max: Vec3;
}

type Mat4 = readonly number[];
```

| Type | Meaning |
| --- | --- |
| `Vec3` | A point or a direction in the world. |
| `Vec2` | A point on the logical field: a screen-space shape's vertex, or the logical point handed to `camera.logicalToRay`. |
| `Quat` | A rotation, as a unit quaternion. Every helper reads one as unit length and returns one at unit length. |
| `Rect` | An axis-aligned rectangle on the logical field or in an image. A `SpriteComponent`'s `source` region is one, in the image's pixels. |
| `Box3` | An axis-aligned box in world units. A collider's `bounds()` returns one and the camera's `bounds` takes one. |
| `Mat4` | Sixteen entries in column-major order, exactly a three `Matrix4`'s `elements`. |

`new THREE.Matrix4().fromArray(m)` reads a `Mat4` and `matrix.toArray()` writes
one.

```ts
import * as THREE from "three";
import type { Component } from "@test-cabinet/structured-3d";

function matrixOf(component: Component): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(component.worldMatrix());
}
```

## `Transform`

```ts
interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}
```

| Field | Identity | Meaning |
| --- | --- | --- |
| `position` | `{ x: 0, y: 0, z: 0 }` | Translation, in world units. |
| `rotation` | `{ x: 0, y: 0, z: 0, w: 1 }` | Orientation, a unit quaternion. |
| `scale` | `{ x: 1, y: 1, z: 1 }` | Scale along each local axis. |

A `Partial<Transform>` on an `ActorSpec` or a `SpawnSpec` fills its absent
fields from the identity, and **a field that is given is given whole** — a spec
that names `position` places the actor unrotated at unit scale, and one that
names `rotation` supplies the whole quaternion.

An actor's `transform` and a component's `offset` are plain mutable records, so
movement is an assignment to a field. A transform places a point by scaling it,
then rotating it, then translating it, which is the order three composes a
matrix from the same three parts.

## Constants

| Constant | Value |
| --- | --- |
| `VEC3_ZERO` | `{ x: 0, y: 0, z: 0 }` |
| `VEC3_ONE` | `{ x: 1, y: 1, z: 1 }` |
| `UP` | `{ x: 0, y: 1, z: 0 }` |
| `FORWARD` | `{ x: 0, y: 0, z: -1 }` |
| `RIGHT` | `{ x: 1, y: 0, z: 0 }` |
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

| Helper | Result |
| --- | --- |
| `vec3(x, y, z)` | A fresh vector. |
| `add(a, b)` | `a + b`, per component. |
| `sub(a, b)` | `a - b`, per component. |
| `scale(v, s)` | `v` with every component multiplied by `s`. |
| `dot(a, b)` | The dot product. |
| `cross(a, b)` | The cross product `a × b`, right-handed. |
| `length(v)` | The Euclidean length. |
| `normalize(v)` | `v` at unit length. The zero vector normalizes to the zero vector. |
| `distance(a, b)` | `length(sub(b, a))`. |
| `lerp(a, b, t)` | `a + (b - a) * t`, per component, with `t` unclamped. |

Integrating a velocity is `add` and `scale`:

```ts
import { add, scale } from "@test-cabinet/structured-3d";

override tick(dt: number): void {
  this.transform.position = add(this.transform.position, scale(this.velocity, dt));
}
```

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

| Helper | Result |
| --- | --- |
| `quat(x, y, z, w)` | A fresh quaternion from its components. |
| `quatFromEuler(x, y, z)` | The rotation of `x` radians about X, `y` about Y, and `z` about Z, composed in the YXZ order below. |
| `quatToEuler(q)` | The Euler angles, `{ x: pitch, y: yaw, z: roll }`, that `quatFromEuler` turns back into `q`, with pitch in `-π/2..π/2`. |
| `quatFromAxisAngle(axis, angle)` | The rotation of `angle` radians about the unit vector `axis`, counterclockwise looking down the axis toward the origin. |
| `quatMultiply(a, b)` | The Hamilton product `a · b`. |
| `quatInverse(q)` | The rotation undoing `q`; for a unit quaternion, its conjugate. |
| `quatRotate(q, v)` | `v` turned by `q`. |
| `quatSlerp(a, b, t)` | The spherical interpolation from `a` at `t = 0` to `b` at `t = 1`, along the shorter arc. |
| `quatLookAt(forward, up)` | The rotation taking `FORWARD` onto `normalize(forward)`, rolled so its local `+Y` lies as near `up` as the direction allows. `up` defaults to `UP`, and a zero `forward` yields the identity. |

### Euler angles

`quatFromEuler(x, y, z)` composes yaw about Y, then pitch about X, then roll
about Z, in the body's own axes. That is three's `Euler` order `"YXZ"`, so
`new THREE.Euler(x, y, z, "YXZ")` and `quatFromEuler(x, y, z)` describe one
rotation.

A yaw alone, `quatFromEuler(0, yaw, 0)`, turns about the world's up axis, and a
heading is read back as `quatToEuler(q).y`. **Keep the heading in a field and
write the quaternion from it** rather than accumulating rotations onto the
quaternion, which drifts.

### The product order

Rotating a vector by `quatMultiply(a, b)` applies `b` first and `a` second:

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

| Helper | Result |
| --- | --- |
| `composeTransforms(parent, child)` | The transform of `child` placed inside `parent`: `position` is `transformPoint(parent, child.position)`, `rotation` is `quatMultiply(parent.rotation, child.rotation)`, and `scale` is the per-component product of the two scales. |
| `transformPoint(t, p)` | `p` scaled by `t.scale` per component, then rotated by `t.rotation`, then translated by `t.position`. |
| `transformToMatrix(t)` | The column-major matrix three's `Matrix4.compose(position, quaternion, scale)` builds from the same three parts. Applying it to a point gives `transformPoint(t, p)`. |

`composeTransforms` is exactly the composition a component's `worldTransform()`
performs, with the actor's transform as `parent` and the component's `offset` as
`child`.

## Moving along a heading

The two calls a pawn needs are `quatFromEuler` to state the heading and
`quatRotate` to turn `FORWARD` into the direction that heading faces:

```ts
import {
  FORWARD,
  Pawn,
  add,
  quatFromEuler,
  quatRotate,
  scale,
} from "@test-cabinet/structured-3d";

export class Ship extends Pawn {
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

`RIGHT` rotated the same way is the strafe axis, and `UP` is the world's up
whatever the pawn is doing, so a move in the horizontal plane is a combination
of the first two with the `y` component of each dropped or left as it is.
