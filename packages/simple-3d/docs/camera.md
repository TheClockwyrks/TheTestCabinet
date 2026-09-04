# The camera and the view

The camera is the engine's and the pose is the game's. `api.camera` is the one
`THREE.PerspectiveCamera` or `THREE.OrthographicCamera` the engine renders
through, and `render` writes its position, its orientation, and its projection
fields each frame from the state. `View` is the read side of the same camera:
the world-space ray through a logical stage point, the logical stage point a
world point draws at, and the camera's pose as a plain value.

## The three spaces

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units | The game, on every scene object |
| Logical | The design size handed to `createEngine` | The camera's projection, at aspect `width / height` |
| Device | Device pixels | The viewport |

The camera carries the first mapping and the viewport the second. A world point
goes through the camera's view and projection matrices into clip space, is
divided by `w` into normalized device coordinates, and lands on the logical
field:

```ts
logicalX = ((ndcX + 1) / 2) * width;
logicalY = ((1 - ndcY) / 2) * height;
depth = ndcZ;

deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;
```

Logical `x` runs rightward and logical `y` runs downward from the top-left of
the design field, exactly as on the screen layer, so a projected point is drawn
on the screen layer at its own coordinates with no second mapping.

## Coordinate conventions

The world is right-handed with `+Y` up, and the camera looks along its local
`-Z`. That is three's convention, so a triple written here means in the engine
what it means in every three example. Angles in the plain math types are
radians, and `fov` is degrees, which is three's convention as well.

## The plain math types

```ts
interface Vec2 { x: number; y: number }
interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }
type Mat4 = readonly number[];
interface Box3 { min: Vec3; max: Vec3 }
```

`Vec2` is a point on the logical field, `Vec3` a point or direction in the
world, `Quat` a rotation as a unit quaternion with the identity
`{ x: 0, y: 0, z: 0, w: 1 }`, `Mat4` sixteen numbers in column-major order so
entries `12..14` are the translation, and `Box3` an axis-aligned box in world
units. Each is plain fields with no methods, so a value moves between the state,
the engine, and three's own classes through `set` and `toArray` and the state is
never obliged to carry a three object.

A rotation carried in the state is a quaternion rather than Euler angles because
a rotation is interpolated, composed, and compared, and Euler angles are
ambiguous under all three.

```ts
mesh.position.set(body.at.x, body.at.y, body.at.z);
mesh.quaternion.set(body.spin.x, body.spin.y, body.spin.z, body.spin.w);
```

## Camera defaults

`EngineOptions.projection` selects the camera's class at construction, and the
class holds for the engine's life.

| Field | Perspective (the default) | Orthographic |
| --- | --- | --- |
| `position` | `(0, 0, 10)` | `(0, 0, 10)` |
| `rotation` | Identity, looking along `-Z` with `+Y` up | Identity, looking along `-Z` with `+Y` up |
| `fov` | `60` | `0` |
| `near` | `0.1` | `0.1` |
| `far` | `1000` | `1000` |
| `zoom` | `1` | `1` |
| `left`, `right` | `0`, `0` | `-width / 2`, `width / 2` |
| `top`, `bottom` | `0`, `0` | `height / 2`, `-height / 2` |

Perspective suits any game that shows depth: an orbit around a structure, a
chase view, a first-person walk. Orthographic suits a board, an isometric field,
or any picture whose size on screen should stay fixed with distance; at its
defaults a world unit on the `z = 0` plane is one logical unit, with the world
origin at the center of the design field and world `+Y` pointing up the screen.

## Posing the camera

The pose lives in the state like every other quantity the picture depends on:
`update` moves it against the frame's delta and the player's input, and `render`
copies it onto the camera. An orbit is three numbers and a point.

```ts
import type { Game, Vec3 } from "@test-cabinet/simple-3d";

const ORBIT_RATE = 1.6;      // radians per second
const ZOOM_PER_UNIT = 0.002; // fraction of the distance per logical unit of wheel
const PITCH_MIN = 0.15;
const PITCH_MAX = 1.4;

interface Orbit {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly target: Vec3;
}

interface State {
  readonly orbit: Orbit;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eye(orbit: Orbit): Vec3 {
  const { yaw, pitch, distance, target } = orbit;
  return {
    x: target.x + distance * Math.cos(pitch) * Math.sin(yaw),
    y: target.y + distance * Math.sin(pitch),
    z: target.z + distance * Math.cos(pitch) * Math.cos(yaw),
  };
}

export const game: Game<State, null> = {
  initialize(api) {
    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.input.register("up", { keys: ["ArrowUp", "KeyW"] });
    api.input.register("down", { keys: ["ArrowDown", "KeyS"] });
    return [
      { orbit: { yaw: 0.6, pitch: 0.5, distance: 12, target: { x: 0, y: 0, z: 0 } } },
      null,
    ];
  },

  update(state, api, dt) {
    const turn = api.input.value("right") - api.input.value("left");
    const tilt = api.input.value("up") - api.input.value("down");
    const zoom = api.input.wheel().y * ZOOM_PER_UNIT;
    const { orbit } = state;
    return {
      orbit: {
        ...orbit,
        yaw: orbit.yaw + turn * ORBIT_RATE * dt,
        pitch: clamp(orbit.pitch + tilt * ORBIT_RATE * dt, PITCH_MIN, PITCH_MAX),
        distance: clamp(orbit.distance * (1 + zoom), 4, 40),
      },
    };
  },

  render(state, api) {
    const at = eye(state.orbit);
    const { target } = state.orbit;
    api.camera.position.set(at.x, at.y, at.z);
    api.camera.lookAt(target.x, target.y, target.z);
  },
};
```

The engine holds a perspective camera's `aspect` at the design aspect and
updates the projection matrix before rendering, so a write from `render` takes
effect on the same frame's picture.

## The projection fields

`fov`, `near`, and `far` are written the same way, from the state. A zoom that
narrows the field of view rather than moving the eye is a `fov` in the state.
`api.camera` is the union of the two classes, so a game narrows with
`instanceof` before writing a field that belongs to one of them.

```ts
import * as THREE from "three";

render(state, api) {
  if (api.camera instanceof THREE.PerspectiveCamera) {
    api.camera.fov = state.zoomed ? 35 : 60;
  } else {
    const vp = api.viewport();
    const half = state.orbit.distance;
    const aspect = vp.width / vp.height;
    api.camera.left = -half * aspect;
    api.camera.right = half * aspect;
    api.camera.top = half;
    api.camera.bottom = -half;
  }
}
```

An orthographic camera's extents are world units, and holding their ratio at the
design aspect keeps a world unit square on screen.

## Dragging with the pointer

A drag orbits the camera by the pointer's travel between frames. The state keeps
where the pointer was on the previous frame while a button is held, and `update`
turns the difference into yaw and pitch. Putting it on the secondary button
leaves the primary free for picking; the engine's gesture claim is what lets the
secondary button reach the game rather than opening the context menu.

```ts
const DRAG_RATE = 0.005; // radians per logical unit

interface State {
  readonly orbit: Orbit;
  readonly drag: { readonly x: number; readonly y: number } | null;
}

update(state, api) {
  const pointer = api.input.pointer();
  const dragging = pointer.buttons.includes("secondary");
  const drag = dragging ? { x: pointer.x, y: pointer.y } : null;
  if (dragging && state.drag !== null) {
    const yaw = state.orbit.yaw - (pointer.x - state.drag.x) * DRAG_RATE;
    const pitch = clamp(
      state.orbit.pitch + (pointer.y - state.drag.y) * DRAG_RATE,
      PITCH_MIN,
      PITCH_MAX,
    );
    return { ...state, drag, orbit: { ...state.orbit, yaw, pitch } };
  }
  return { ...state, drag };
}
```

The pointer arrives in logical stage coordinates, already mapped through the
device pixel ratio, the letterbox bars, and the scale, so a rate per logical
unit feels the same at every window size.

## `View`

```ts
interface View {
  camera(): CameraSnapshot;
  ray(x: number, y: number): Ray;
  project(point: Vec3): Projected;
}

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
```

| Method | Result |
| --- | --- |
| `camera()` | The camera's pose and projection as a value the caller owns. |
| `ray(x, y)` | A world-space ray through the logical stage point `(x, y)`. |
| `project(point)` | The logical stage point a world point draws at, with its depth and whether it is in view. |

`ray.direction` is unit length. Through a perspective camera the ray starts at
the camera's position and points through the stage point; through an
orthographic camera it starts at the stage point on the near plane and points
along the view direction, so a game intersecting it writes the same arithmetic
under either projection.

`Projected.depth` is normalized device depth in `-1..1`, near to far, which is
what sorts two labels that overlap. A point outside the frustum still reports
`x`, `y`, and `depth`, so an off-screen marker has a direction to clamp toward,
and a point behind the camera reports `visible: false`.

`engine.view()`, `UpdateApi.view()`, and `RenderApi.view()` return the same
`View`. Every result is a fresh value, so nothing a caller holds is written by a
later render.

## As it stood at the most recent render

**`View` answers from the camera as it stood at the most recent render.** The
engine reads the camera's world and projection matrices after `render` returns,
in step 7 of the frame, and every `view()` answers from that reading until the
next render. Before the first render it answers from the camera defaults.

`update` therefore picks against the camera the player is looking through — the
one the previous frame drew — and `render` reads that same pose, which coincides
with the one it is currently writing whenever the camera is still.

## Picking with `ray`

A pick turns a stage point into a ray and asks what the ray hits. `UpdateApi`
carries no scene, so the ray is tested against the state's own bodies in plain
math, and the answer — the id that was hit — goes into the state for `render` to
show. That keeps the pick agreeing with the simulation whatever detail the mesh
that shows it has.

```ts
import type { Ray, Vec3 } from "@test-cabinet/simple-3d";

interface Body {
  readonly id: number;
  readonly center: Vec3;
  readonly radius: number;
}

interface State {
  readonly bodies: readonly Body[];
  readonly selected: number | null;
}

function hitDistance(ray: Ray, body: Body): number | null {
  const ox = ray.origin.x - body.center.x;
  const oy = ray.origin.y - body.center.y;
  const oz = ray.origin.z - body.center.z;
  const { x: dx, y: dy, z: dz } = ray.direction;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - body.radius * body.radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

update(state, api) {
  if (!api.input.pointerPressed()) return state;
  const pointer = api.input.pointer();
  const ray = api.view().ray(pointer.x, pointer.y);

  let selected: number | null = null;
  let nearest = Infinity;
  for (const body of state.bodies) {
    const t = hitDistance(ray, body);
    if (t !== null && t < nearest) {
      nearest = t;
      selected = body.id;
    }
  }
  return { ...state, selected };
}
```

Because `ray.direction` is unit length the sphere test drops the quadratic's
leading coefficient, and the `t` it returns is the distance in world units along
the ray, so the nearest hit is the one in front.

A pick against the ground is the ray's intersection with the `y = 0` plane,
which is what "place a thing where the player pointed" reads:

```ts
function onGround(ray: Ray): Vec3 | null {
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: 0,
    z: ray.origin.z + ray.direction.z * t,
  };
}
```

The snapshot is where the sweep ended. A game that reacts to the path the
pointer traveled reads `api.input.pointerSamples()` and casts a ray per sample.

## Projecting a world point for a label

`project` gives the logical stage point a world point draws at, in the same
coordinates the screen layer draws in, so a label, a health bar, or a marker
follows an object in the world by drawing at the projected point. `visible` is
what decides whether to draw it at all.

```ts
render(state, api) {
  api.screen.font = "14px monospace";
  api.screen.textAlign = "center";
  api.screen.textBaseline = "bottom";
  for (const body of state.bodies) {
    const label = api.view().project({
      x: body.center.x,
      y: body.center.y + body.radius + 0.3,
      z: body.center.z,
    });
    if (!label.visible) continue;
    api.screen.fillStyle = body.id === state.selected ? "#f5d76e" : "#ffffff";
    api.screen.fillText(`#${body.id}`, label.x, label.y);
  }
}
```

A label projected this way sits exactly where the body is whenever the camera is
still, and one frame behind while the camera moves. A label that must track a
moving camera on the same frame projects through three itself, after the camera
is posed:

```ts
import * as THREE from "three";
import type { SceneCamera, Vec2, Vec3, Viewport } from "@test-cabinet/simple-3d";

function projectNow(camera: SceneCamera, point: Vec3, vp: Viewport): Vec2 {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: ((ndc.x + 1) / 2) * vp.width, y: ((1 - ndc.y) / 2) * vp.height };
}
```

That is the same mapping stated at the top of this page, applied to the camera
as `render` just left it.

## The letterbox rule

The camera's aspect is the design aspect, so the picture keeps its shape
whatever the canvas element's is, and the letterbox bars absorb the difference.
The pointer maps onto the same logical field the picture fills, so a point
inside a bar maps outside `0..width` or `0..height`. A ray through such a point
is a ray outside the picture, and a game either clamps the point into the field
or treats it as a miss.

```ts
function onStage(point: Vec2, vp: Viewport): boolean {
  return point.x >= 0 && point.x <= vp.width && point.y >= 0 && point.y <= vp.height;
}

update(state, api) {
  const pointer = api.input.pointer();
  if (!api.input.pointerPressed() || !onStage(pointer, api.viewport())) return state;
  return pick(state, api.view().ray(pointer.x, pointer.y));
}
```

The same field bounds a projected point: a world point inside the frustum
projects into `0..width` by `0..height`, and one outside reports
`visible: false`, so a label is drawn on the field or skipped rather than drawn
into a bar.

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

The camera's pose and projection at one moment, as a plain value the caller
owns. Every field is present whichever projection the camera is, with the fields
the other projection owns reading `0`, so a reader takes a figure without
narrowing on `projection` first: `fov` is `0` for an orthographic camera, and
the four extents are `0` for a perspective one.

A game keeps its own pose in the state and has no need of the snapshot during a
frame. It is what a case's checks read through `engine.view().camera()` to
assert where a build's camera stood. A camera the game never poses stays at the
defaults; a game whose picture is fixed writes the pose from `render` on every
frame all the same, so the camera is the state's answer rather than a default
the state happens to match.
