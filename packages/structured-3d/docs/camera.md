# Camera and viewport

A game places its actors in world units. The camera projects the world onto the
logical design size handed to `createEngine`, through a perspective or
orthographic projection, and the viewport maps that logical field onto the
canvas's backing store. The pipeline renders the world pass through the camera
and draws the screen pass through the viewport alone.

## The three spaces

| Space   | Unit                                     | Set by                       |
| ------- | ---------------------------------------- | ---------------------------- |
| World   | World units                              | The game, on every transform |
| Logical | The design size handed to `createEngine` | The camera                   |
| Device  | Device pixels                            | The viewport                 |

A world point passes through the camera's view matrix (the inverse of its world
transform) and its projection matrix, then the perspective divide, and lands on
the logical field:

```ts
// clip = projection · inverse(cameraWorld) · [worldX, worldY, worldZ, 1]
ndcX = clipX / clipW;
ndcY = clipY / clipW;

logicalX = width / 2 + (ndcX * width) / 2;
logicalY = height / 2 - (ndcY * height) / 2;

deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;
```

Logical `x` runs rightward and logical `y` runs downward from the top-left of
the design field, exactly as on the screen layer, so a projected point is drawn
by a `screen` component at its own coordinates with no second mapping. The
device pair inverts as `(deviceX - offsetX) / scale`.

A render component in `screen` space skips the first map: its composed transform
is logical coordinates, and the viewport alone carries it onto the screen layer.
See `rendering.md`.

## Coordinate conventions

The world is right-handed with `+Y` up, and the camera looks along its local
`-Z` with local `+Y` up. That is three's convention, so a triple written here
means in the engine what it means in every three example. Angles are radians,
and `fov` alone is degrees, which is three's convention as well.

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

| Field         | Default                      | Meaning                                                                        |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `position`    | `{ x: 0, y: 0, z: 10 }`      | The camera's world position.                                                   |
| `rotation`    | `{ x: 0, y: 0, z: 0, w: 1 }` | The camera's world rotation. It looks along its local `-Z` with local `+Y` up. |
| `projection`  | `"perspective"`              | The projection the world pass renders through.                                 |
| `fov`         | `60`                         | The vertical field of view in degrees, read under `perspective`.               |
| `near`        | `0.1`                        | The near clipping plane, in world units from the camera.                       |
| `far`         | `1000`                       | The far clipping plane, in world units from the camera.                        |
| `orthoHeight` | The logical design height    | The world units the view spans vertically, read under `orthographic`.          |
| `bounds`      | `null`                       | A box in world units the camera's position is kept inside.                     |
| `target`      | `null`                       | The actor the camera follows.                                                  |

| Method           | Result                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `follow`         | Sets `target`. `null` clears it and returns the pose to the game.                                                                             |
| `lookAt`         | Writes `rotation` so the camera looks from `position` toward `point`, with local `+Y` as near `up` as the view allows. `up` defaults to `UP`. |
| `snapshot`       | The projection as a value the caller owns.                                                                                                    |
| `worldToLogical` | A world point on the logical field, through the camera as it stands at the call.                                                              |
| `logicalToRay`   | A world-space ray through a logical point, from the camera as it stands at the call.                                                          |

A world's camera starts at those defaults, at `(0, 0, 10)` looking along `-Z` at
the origin, so a mesh at the origin is in view before the game moves anything.
Under `orthographic` at the default `orthoHeight`, one world unit on the `z = 0`
plane is one logical unit, and the logical field's center is the world origin.

The camera is reached as `world.camera` and is part of the world, so a level
transition builds a new one at the defaults.

## Posing the camera

The pose is written from a tick, most naturally the game mode's or a camera
actor's. `lookAt` writes the rotation, so an orbit is three numbers and a point:

```ts
import { GameMode, vec3 } from "@clockwyrks/structured-3d";
import type { Vec3 } from "@clockwyrks/structured-3d";

const PITCH_MIN = 0.15;
const PITCH_MAX = 1.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class ArenaMode extends GameMode {
  yaw = 0.6;
  pitch = 0.5;
  dist = 12;
  target: Vec3 = vec3(0, 0, 0);

  override tick(dt: number): void {
    this.pitch = clamp(this.pitch, PITCH_MIN, PITCH_MAX);

    const camera = this.world.camera;
    camera.position = vec3(
      this.target.x + this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
      this.target.y + this.dist * Math.sin(this.pitch),
      this.target.z + this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
    );
    camera.lookAt(this.target);
  }
}
```

`fov`, `near`, `far`, `projection`, and `orthoHeight` are written the same way,
as plain fields. Switching to `orthographic` is one assignment and the extents
follow from `orthoHeight`; a perspective camera's aspect is held at the design
aspect by the engine.

## Following a view target

An actor is a view target by carrying a `CameraComponent`. `follow(actor)` sets
`target`; each frame, before the pipeline draws, a camera with a target takes
the first enabled `CameraComponent` the target holds and adopts that component's
world position and rotation and its `fov`, then clamps the position to `bounds`.

Because the component's `offset` is composed with the actor's transform, a chase
camera is an offset behind and above the pawn rather than a second actor: it
rides the pawn's frame and turns with it.

```ts
import {
  CameraComponent,
  MeshComponent,
  Pawn,
  quatFromEuler,
  vec3,
} from "@clockwyrks/structured-3d";

export class Ship extends Pawn {
  readonly view: CameraComponent;

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "capsule", radius: 0.4, height: 1 },
        material: { color: "#d9d9d9" },
      }),
    );

    this.view = this.attach(new CameraComponent({ fov: 55 }));
    this.view.offset.position = vec3(0, 3, 8);
    this.view.offset.rotation = quatFromEuler(-0.25, 0, 0);
  }

  override possessedBy(): void {
    this.world.camera.follow(this);
    this.world.camera.bounds = {
      min: vec3(-40, 1, -40),
      max: vec3(40, 30, 40),
    };
  }
}
```

`follow(null)` releases the target, and the game writes `position`, `rotation`,
and `fov` itself again.

## Bounds

`bounds` is a box in world units the camera's `position` is kept inside. Each
frame, before the pipeline draws and after a followed target has been adopted,
each axis of `position` is clamped on its own to the box's `min` and `max` on
that axis, and the clamped value is written back. The projection is left as it
stands, so the clamp moves the camera and changes nothing about what it sees
from where it ends up.

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

| `Projected` field | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `x`, `y`          | The logical point the world point draws at.                                                    |
| `depth`           | Normalized device depth in `-1..1`, near to far, which is what sorts two labels that overlap.  |
| `visible`         | Whether the point lies inside the camera's frustum. A point behind the camera reports `false`. |

`worldToLogical` gives the logical point a world point draws at, in the same
coordinates the screen layer draws in, so a label, a health bar, or a marker
follows an object in the world by drawing at the projected point. `visible` is
what decides whether to draw it at all. See the `DrawComponent` example in
`rendering.md`.

`logicalToRay` is the inverse question: the world-space line a logical point
picks along. `direction` is unit length. Under `perspective` the ray starts at
the camera's position and points through the logical point; under
`orthographic` it starts on the near plane at that point and points along the
camera's forward axis, so a game intersecting it writes the same arithmetic
under either projection.

A pick is that ray handed to the collision world:

```ts
const ray = this.world.camera.logicalToRay(this.input.pointer());
const hit = this.world.collision.raycast(ray.origin, ray.direction, 100, {
  channel: CHANNELS.cursor,
  responses: { [CHANNELS.target]: "overlap" },
});
```

A pick against the ground plane is arithmetic the game does itself:

```ts
import type { Ray, Vec3 } from "@clockwyrks/structured-3d";

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
the other projection owns reading `0`: `fov` is `0` under `orthographic`, and
the four extents are `0` under `perspective`. `zoom` is three's zoom factor and
the world's camera reports `1`. Under `orthographic`, `top` is
`orthoHeight / 2`, `bottom` is `-top`, `right` is `top * width / height`, and
`left` is `-right`.

`camera.snapshot()` returns one, and a `DrawComponent` reads one from
`api.camera()`.

## The letterbox rule

The camera's aspect is the design aspect, so the picture keeps its shape
whatever the canvas element's is, and the letterbox bars absorb the difference.
The pointer maps onto the same logical field the picture fills, so a point
inside a bar maps outside `0..width` or `0..height`. A ray through such a point
is a ray outside the picture, and a game either clamps the point into the field
or treats it as a miss:

```ts
const pointer = this.input.pointer();
const vp = this.world.viewport();
const onStage =
  pointer.x >= 0 &&
  pointer.x <= vp.width &&
  pointer.y >= 0 &&
  pointer.y <= vp.height;
if (!onStage) return;
```

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

| Field     | Meaning                                                                |
| --------- | ---------------------------------------------------------------------- |
| `width`   | The logical design width.                                              |
| `height`  | The logical design height.                                             |
| `scale`   | Device pixels per logical unit, with the device pixel ratio folded in. |
| `offsetX` | The left letterbox bar, in device pixels.                              |
| `offsetY` | The top letterbox bar, in device pixels.                               |

`scale` and both offsets are device pixels. The CSS-pixel figure is `scale`
divided by the device pixel ratio.

`engine.viewport()`, `world.viewport()`, `InitApi.viewport()`, and a
`DrawComponent`'s `api.viewport()` all return the current fit. Each call returns
a snapshot the caller owns, so a held viewport keeps the values of the frame it
was read in.

Each frame the renderer's viewport and scissor are set to the letterboxed
rectangle, `offsetX`, `offsetY`, `width * scale` by `height * scale` in device
pixels, with the scissor test on. The whole canvas is cleared to `background`
before the scissor is applied, so the letterbox bars carry the background color.
The screen layer is composited over that rectangle pixel for pixel, since both
canvases share one backing-store size.

## The viewport functions

The three functions the engine's own fit is built from are exported, for a
caller that maps coordinates or drives a canvas of its own.

```ts
function fitViewport(
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport;

function applyViewport(ctx: CanvasRenderingContext2D, viewport: Viewport): void;

function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: SurfaceMetrics,
): Viewport;
```

`fitViewport` computes the letterboxed fit. The scale is uniform — the smaller
of `cssWidth / logicalWidth` and `cssHeight / logicalHeight`, multiplied by
`dpr` — so the aspect ratio holds and the whole logical field stays visible. The
leftover space on the long axis is split into two equal letterbox bars, computed
against the rounded device size the backing store is written at, so the two bars
sum to the drawable area exactly. A degenerate input — a surface measuring zero
on either axis, or a logical size that is not finite and positive — yields a
`scale` of `0`, which draws nothing for the frame it applies to and recovers on
its own once the element has a size. A ratio that is not finite and positive is
read as `1`.

`applyViewport` sets the context transform to the viewport, as
`setTransform(scale, 0, 0, scale, offsetX, offsetY)`. The transform is replaced
rather than composed, so every frame starts from the viewport whatever state the
previous frame's render left the context in. The pipeline applies it to the
screen layer's context every frame.

`syncCanvas` brings a canvas's backing store in line with the size and ratio the
surface reports, and returns the fit. The backing store is
`round(cssWidth * dpr)` by `round(cssHeight * dpr)`, written only when it
differs from the current values, since assigning `canvas.width` reallocates and
clears the canvas. A surface reporting zero on either axis leaves the backing
store as it stands and returns a viewport whose scale is zero.

## Resynced every frame

The engine recomputes the fit at the top of every frame, from what the surface
reports at that moment, and once when the engine is created so the first read of
`engine.viewport()` reports a real fit. A window resize, a device pixel ratio
change from a display switch, and a layout change that fires no event at all
each correct themselves within one frame.

The engine pins a pixel CSS size onto the canvas only while the reported size
still matches the backing-store attributes, which is what stops the backing
store from feeding back into the next measurement. Sizing the canvas from CSS,
as `README.md` shows, keeps the page out of that loop.

## `SurfaceMetrics`

```ts
interface SurfaceMetrics {
  cssWidth(): number;
  cssHeight(): number;
  dpr(): number;
  events(): EventTarget;
  origin?(): { x: number; y: number };
  claimGestures?(): () => void;
  capturePointer?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}
```

The engine reads the canvas's laid-out size and device pixel ratio through this
seam every frame, and attaches its key and pointer listeners to the event target
it returns. Supplied through `EngineOptions.surface`, it replaces every
measurement the engine would otherwise take from the DOM, which is what lets the
engine run over a canvas with no document behind it.

`origin()` is the canvas's top-left corner in the client coordinate space
pointer events report their positions in, and it is what the engine subtracts
before mapping a pointer position onto the logical field. Absent, the origin
reads `(0, 0)`. `claimGestures()` takes the browser's own pointer gestures and
returns the function that gives them back, and `capturePointer` /
`releasePointerCapture` keep a drag that leaves the canvas delivering moves. The
last three are optional.

Absent entirely, the engine reads the canvas's element size, the owning window's
device pixel ratio, and the canvas's bounding rectangle for the origin, listens
on the canvas's owning document, and claims and captures pointers on the canvas
element. A build in the browser supplies no surface.
