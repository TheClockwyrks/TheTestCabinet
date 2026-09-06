---
title: The Camera and Pointer
---

The camera is the engine's and the pose is the game's. `api.camera` is the one
`THREE.PerspectiveCamera` or `THREE.OrthographicCamera` the engine renders
through, and `render` writes its position, its orientation, and its projection
fields each frame from the state. The pose therefore lives in the state like
every other quantity the picture depends on: `update` moves it against the
frame's delta and the player's input, and `render` copies it onto the camera.

```ts
import type { Game, Vec3 } from "@clockwyrks/simple-3d";

const ORBIT_RATE = 1.6; // radians per second
const ZOOM_PER_UNIT = 0.002; // fraction of the distance per logical unit of wheel travel
const PITCH_MIN = 0.15; // radians above the ground plane
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
      {
        orbit: {
          yaw: 0.6,
          pitch: 0.5,
          distance: 12,
          target: { x: 0, y: 0, z: 0 },
        },
      },
      null,
    ];
  },

  update(state, api, dt) {
    const turn = api.input.value("right") - api.input.value("left");
    const tilt = api.input.value("up") - api.input.value("down");
    const zoom = api.input.wheel().y * ZOOM_PER_UNIT;
    const { orbit } = state;
    return {
      ...state,
      orbit: {
        ...orbit,
        yaw: orbit.yaw + turn * ORBIT_RATE * dt,
        pitch: clamp(
          orbit.pitch + tilt * ORBIT_RATE * dt,
          PITCH_MIN,
          PITCH_MAX,
        ),
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

An orbit is three numbers and a point: the yaw around the target, the pitch
above it, and the distance from it. `update` turns the yaw and pitch at a rate
per second and scales the distance by the wheel's travel, and `render` turns
those into an eye position and a `lookAt`. The engine holds a perspective
camera's `aspect` at the design aspect and updates the projection matrix before
rendering, so the write takes effect on the same frame's picture.

## The projection fields

`fov`, `near`, and `far` are written the same way, from the state, when the
game changes them. A zoom that narrows the field of view rather than moving the
eye is a `fov` in the state, and `render` writes it after checking which camera
class the engine built, since an orthographic camera carries extents instead.

```ts
import * as THREE from "three";

render(state, api) {
  if (api.camera instanceof THREE.PerspectiveCamera) {
    api.camera.fov = state.zoomed ? 35 : 60;
  } else {
    const half = state.orbit.distance;
    const aspect = api.viewport().width / api.viewport().height;
    api.camera.left = -half * aspect;
    api.camera.right = half * aspect;
    api.camera.top = half;
    api.camera.bottom = -half;
  }
}
```

An orthographic camera's extents are world units, and holding their ratio at
the design aspect keeps a world unit square on screen. The
[camera defaults](/engines/simple-3d/apis/view/) span the design size, so a
game that leaves them alone has one logical unit per world unit on the `z = 0`
plane.

## Dragging with the pointer

A drag orbits the camera by the pointer's travel between frames. The state
keeps where the pointer was on the previous frame while a button is held, and
`update` turns the difference into yaw and pitch. The secondary button leaves
the primary free for picking, and the engine's gesture claim is what lets it
reach the game instead of opening the context menu.

```ts
const DRAG_RATE = 0.005;   // radians per logical unit

interface State {
  readonly orbit: Orbit;
  readonly drag: { readonly x: number; readonly y: number } | null;
}

update(state, api, dt) {
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
device pixel ratio, the letterbox bars, and the scale, so the travel is in the
same units the screen layer draws in and a rate per logical unit feels the same
at every window size. The pointer is captured as it comes into contact, so a
drag that leaves the canvas keeps delivering moves and its release is seen.

## Picking with `view().ray`

A pick turns a stage point into a world-space ray and asks what the ray hits.
`api.view().ray(x, y)` is the ray through the logical point `(x, y)`, from the
camera as it stood at the most recent render, which is the camera the player is
looking through. `UpdateApi` carries no scene, so the ray is tested against the
state's own bodies in plain math, and the answer, the id that was hit, goes into
the state for `render` to show.

```ts
import type { Ray, Vec3 } from "@clockwyrks/simple-3d";

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

update(state, api, dt) {
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

`ray.direction` is unit length, which is what lets the sphere test drop the
quadratic's leading coefficient, and the distance it returns is in world units
along the ray, so the nearest hit is the one in front. A body the state
describes as a box or a capsule is tested the same way, against the shape the
state holds rather than the mesh that shows it, so the pick agrees with the
simulation whatever the mesh's detail.

A pick against the ground is the ray's intersection with the `y = 0` plane,
which is what placing a thing where the player pointed reads.

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

The pick is resolved on the frame the press arrived, against the camera the
previous frame drew, which is the camera the player aimed with; a camera moved
by this frame's `update` reaches the screen on this frame's render. The
snapshot is where the sweep ended; a game that reacts to the path the
pointer traveled reads `api.input.pointerSamples()` and casts a ray per sample.

## Projecting a world point for a label

`api.view().project(point)` is the logical stage point a world point draws at,
its normalized depth, and whether it lies inside the frustum. The screen layer
draws in the same logical coordinates, so a readout anchored to a body in the
world is drawn at the projected point as it stands.

```ts
render(state, api) {
  const at = eye(state.orbit);
  api.camera.position.set(at.x, at.y, at.z);
  api.camera.lookAt(state.orbit.target.x, state.orbit.target.y, state.orbit.target.z);

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

`view()` answers from the camera as it stood at the previous frame's render,
because the engine takes its reading after `render` returns. A label projected
this way sits exactly where the body is whenever the camera is still, and one
frame behind while the camera moves. A label that must track a moving camera on
the same frame projects through three itself, after the camera is posed:

```ts
import * as THREE from "three";
import type { SceneCamera, Vec2, Vec3, Viewport } from "@clockwyrks/simple-3d";

function projectNow(camera: SceneCamera, point: Vec3, vp: Viewport): Vec2 {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: ((ndc.x + 1) / 2) * vp.width, y: ((1 - ndc.y) / 2) * vp.height };
}
```

That is the same mapping the [view](/engines/simple-3d/apis/view/) page states,
applied to the camera as `render` just left it. `depth` from `project` is what
sorts two labels that overlap, nearer on top, and `visible: false` is what
keeps a label off the screen layer for a body behind the camera.

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

update(state, api, dt) {
  const pointer = api.input.pointer();
  if (!api.input.pointerPressed() || !onStage(pointer, api.viewport())) return state;
  return pick(state, api.view().ray(pointer.x, pointer.y));
}
```

The same field bounds a projected point. A world point inside the frustum
projects into `0..width` by `0..height`, and one outside it reports
`visible: false` whatever coordinates it carries, so a label is drawn on the
field or skipped rather than drawn into a bar.

## Reading the camera back

`api.view().camera()` is the camera's pose and projection as a plain value the
caller owns: position, rotation as a quaternion, `fov`, `near`, `far`, and an
orthographic camera's extents. A game keeps its own pose in the state and has
no need of it during a frame; it is what a validator reads through
`engine.view().camera()` to assert where a build's camera stood, and what a
diagnostic source summarizes from the state's orbit rather than from the
camera.

A camera the game never poses stays at the [camera
defaults](/engines/simple-3d/apis/view/), at `(0, 0, 10)` looking along `-Z`,
which frames the origin at the center of the field. A game whose picture is
fixed writes the pose once from `render` on every frame all the same, so the
camera is the state's answer rather than a default the state happens to match.
