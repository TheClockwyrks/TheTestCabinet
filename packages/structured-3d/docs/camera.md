# The camera, the viewport, and the math

A game places its actors in world units. The camera's frustum projects the world
into the logical design size handed to `createEngine`, and the viewport maps
that logical field onto the canvas's backing store. Every screen-space position
— the pointer, a projected point — is in logical coordinates.

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units, y-up, right-handed | The game, on every transform |
| Logical | The design size handed to `createEngine`, y-down | The camera's projection |
| Device | Device pixels | The viewport |

The world is right-handed with **+Y up** and +X right, a camera looks down its
**local −Z**, and front faces wind counter-clockwise. A world unit means
whatever the game decides, and angles are radians everywhere — rotations and
field of view alike.

The logical field keeps the 2D convention: origin top-left, x right, **y down**.
The flip between the y-up world and the y-down field lives in the projection's
NDC step and nowhere else.

## Math types

```ts
interface Vec2 { x: number; y: number }
interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }

interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

interface Box3 { min: Vec3; max: Vec3 }
interface Ray { origin: Vec3; direction: Vec3 }
```

`Vec2` is a point in the logical field: a pointer position, a projected point.
`Vec3` is a point or a direction in world units. `Quat` is the orientation
representation; there is no Euler type, identity is `{ x: 0, y: 0, z: 0, w: 1
}`, and a readable rotation is built with `quatFromAxisAngle`. `Transform`
composes scale, then rotation, then translation. `Box3` is the axis-aligned box
a collider's `bounds()` and a `MeshHandle`'s `bounds` are.

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
from `fovY` and that aspect. The picture is therefore identical on every canvas,
letterboxed by the viewport exactly as a 2D picture is, which is what keeps a
validator's fixed surface mapping to known pixels.

`CameraState` is a plain value the caller owns: `camera.snapshot()` returns one,
a `DrawComponent` reads one from `api.camera()`, and a recording carries one in
each frame's inherited state.

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
| `project` | `projectPoint(snapshot(), viewport, point)`: the world point in logical coordinates, or `null` at or behind the camera plane. |
| `ray` | `pointerRay(snapshot(), viewport, point)`: the picking ray through a logical point. |

The camera is reached as `world.camera` and is part of the world, so a level
transition builds a new one at the defaults. `lookAt` with `point` equal to
`position` leaves `rotation` unchanged, and an aim parallel to the world's y
axis holds +Z as up instead.

There is **no zoom and no bounds**: framing is `position`, `rotation`, and
`fovY`, so "closer" is moving the camera or narrowing `fovY`, and a frustum has
no 2D clamp rectangle. A game that confines its framing writes the confinement
into the code that moves the camera.

## Following a view target

An actor is a view target by carrying a `CameraComponent`. `follow(actor)` sets
`target`, and each frame, before the pipeline draws, the engine writes
`position`, `rotation`, and `fovY` from the target's first enabled
`CameraComponent`, adopting that component's world position and rotation and its
`fovY`; `near` and `far` stay as set.

```ts
constructor() {
  super();
  this.attach(new MeshComponent({ mesh: meshes.ship }));

  const cam = this.attach(new CameraComponent({ fovY: Math.PI / 4 }));
  cam.offset.position = { x: 0, y: 2, z: 6 };
}

override beginPlay(): void {
  this.world.camera.follow(this);
}
```

The component's `offset` shifts the view relative to its actor, so the chase
camera above sits two units up and six behind — behind is local +Z, since the
actor's forward is −Z and an identity offset looks the way the ship points.
`follow(null)` releases the target and leaves the camera wherever the game
writes it; a released camera is aimed with `world.camera.lookAt(point)`.

## Projection and picking

```ts
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
engine performs is a composition of them with the viewport equations. Normalized
device coordinates sit between the two spaces: `ndcX = 2 * logicalX / width - 1`
and `ndcY = 1 - 2 * logicalY / height`. The y flip lives here and nowhere else.

`projectPoint` maps a world point through the camera's view and perspective
projection into logical coordinates. A point at or behind the camera plane
returns `null` — the cue to skip a label. A visible point maps into `0..width` ×
`0..height`; a point outside the frustum maps outside that range and is returned
as-is.

`pointerRay` is the picking convention: `origin` is the camera's position, and
`direction` is the unit vector through the given logical point on the near
plane. A point inside a letterbox bar is outside the field and still yields a
ray, since the math extends past the field's edge; treating it as a miss is the
game's choice. For a point in front of the camera, `pointerRay(c, v,
projectPoint(c, v, p))` passes through `p`.

The pointer stays 2D. Mapping a pointer position into the scene is done by
whoever needs it, and a controller that picks does it in two calls:

```ts
const ray = this.world.camera.ray(this.input.pointer());
const hit = this.world.collision.raycast(ray.origin, ray.direction, 100);
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

| Field | Meaning |
| --- | --- |
| `width` | The logical design width. |
| `height` | The logical design height. |
| `scale` | Device pixels per logical unit, with the device pixel ratio folded in. |
| `offsetX` | The left letterbox bar, in device pixels. |
| `offsetY` | The top letterbox bar, in device pixels. |

```ts
deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;

logicalX = (deviceX - offsetX) / scale;
logicalY = (deviceY - offsetY) / scale;
```

`scale` and both offsets are device pixels; the CSS-pixel figure is `scale`
divided by the device pixel ratio. There is no `applyViewport` and no transform
to set — there is no 2D context in this package: the renderer maps the logical
field onto the letterboxed device rectangle itself, its device viewport and
scissor being the fit, and clears the bars outside the picture. The two
equations above are the whole observable contract, so the device pixel a world
point drew into is `projectPoint` followed by the first pair.

## `fitViewport` and `syncCanvas`

```ts
function fitViewport(
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport;

function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: SurfaceMetrics,
): Viewport;
```

The scale is uniform: the smaller of `cssWidth / logicalWidth` and `cssHeight /
logicalHeight`, multiplied by `dpr`. A single scale preserves the aspect ratio
and keeps the whole logical field visible. The leftover space on the long axis
is split into two equal bars, which are the offsets, computed against the
rounded device size the backing store is written at, so the two bars sum to the
drawable area exactly.

`syncCanvas` brings the backing store in line with what the surface reports and
returns the fit. The engine calls it at the top of every frame, and once during
construction, so the first `engine.viewport()` read reports a real fit. The
store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`, written only when
it differs from the current values, since assigning `canvas.width` reallocates
and clears the canvas.

A degenerate input yields a `scale` of `0`: a surface measuring zero on either
axis, or a logical size that is not finite and positive. A ratio that is not
finite and positive is read as `1`. A surface reporting zero leaves the backing
store as it stands, keeping the last frame on screen, and the fit recovers on
its own once the element has a size.

### Pinning the CSS size

An element the page has not sized takes its CSS size from the `width` and
`height` attributes, which are exactly what the backing store writes — so
writing the store would feed the next measurement and the element would grow by
the device pixel ratio every frame. The engine breaks that loop by pinning the
measured size, and only then.

| Measurement | The engine writes |
| --- | --- |
| The reported CSS size equals the size the backing-store attributes imply | `style.width` and `style.height` in pixels, equal to the measurement, alongside the backing store |
| The page sized the element, inline or through a stylesheet | The backing store alone |

## Measuring through the surface

```ts
interface SurfaceMetrics {
  cssWidth(): number;
  cssHeight(): number;
  dpr(): number;
  events(): EventTarget;
  origin?(): { x: number; y: number };
}
```

Every figure the fit is computed from arrives through this seam, and the
engine's key and pointer listeners go on the event target it returns. `origin()`
is the canvas's top-left corner in the client coordinate space pointer events
report in, and it is what the engine subtracts before mapping a pointer
position; absent, it reads `(0, 0)`.

Absent entirely, the engine reads the canvas's `clientWidth`, `clientHeight`,
the owning window's `devicePixelRatio`, and the canvas's bounding rectangle for
the origin, and listens on the canvas's owning document. A supplied surface
replaces every one of those measurements, which is what lets the engine run over
a canvas with no document behind it and gives a check the same transform on
every machine.

## Resynced every frame

The engine recomputes the fit at the top of every frame, from what the surface
reports at that moment, and before any game code runs, so a tick that projects a
point uses the fit this frame renders through. A window resize, a device pixel
ratio change from a display switch, and a layout change that fires no event at
all each correct themselves within one frame.

`engine.viewport()`, `world.viewport()`, `InitApi.viewport()`, and a
`DrawComponent`'s `api.viewport()` all return the current fit, each as a
snapshot the caller owns, so a held viewport keeps the values of the frame it
was read in.
