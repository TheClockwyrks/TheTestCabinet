# The viewport, the camera, and the math

A game simulates in world units of its own and is projected into the logical
design size it declared to `createEngine`. The camera does the world-to-logical
half, and the viewport does the logical-to-device half.

| Space | Unit | Set by |
| --- | --- | --- |
| World | World units, y-up, right-handed | The game |
| Logical | The design size handed to `createEngine`, y-down | The camera's projection |
| Device | Device pixels | The viewport |

The world is right-handed with **+Y up** and +X right, a camera looks down its
**local −Z**, and front faces wind counter-clockwise. A world unit means
whatever the game decides, and angles are radians everywhere — rotations and
field of view alike.

The logical field keeps the 2D convention: origin top-left, x right, **y down**.
The pointer, a projected point, and every HUD coordinate are in logical units.
The flip between the y-up world and the y-down field lives in the camera's
projection and nowhere else.

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
`Quat` is the orientation representation; there is no Euler type, and a readable
rotation is built with `quatFromAxisAngle`. Identity is
`{ x: 0, y: 0, z: 0, w: 1 }`, and the functions that produce a quaternion keep it
unit-length.

`Transform` composes scale, then rotation, then translation. Identity is
position `(0, 0, 0)`, identity rotation, scale `(1, 1, 1)`. `Box3` is the
axis-aligned box a `Geometry`'s and a `MeshHandle`'s `bounds` are.

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
letterboxed by the viewport, which is what lets a check with a fixed surface know
the exact pixel a world point drew into.

`CameraState` is a plain value. The game keeps one in its own state and applies
it with `scene.setCamera`, and each frame of a recording carries the camera it
inherited. The scene context is write-only, so the game's own state stays the
single source of truth for where the camera is.

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

`scale` and both offsets are device pixels; the CSS-pixel figure is `scale`
divided by the device pixel ratio. The viewport is recomputed at the top of every
frame from the size and ratio the surface reports.

```ts
deviceX = offsetX + logicalX * scale;
deviceY = offsetY + logicalY * scale;

logicalX = (deviceX - offsetX) / scale;
logicalY = (deviceY - offsetY) / scale;
```

There is no `applyViewport` and no transform to set: the renderer maps the
logical field onto the letterboxed device rectangle itself — its device viewport
and scissor are the fit — and clears the bars outside the picture. The two
equations above are the whole observable contract.

The device pixel a world point drew into is therefore `projectPoint` followed by
the first pair of equations, and a pointer event, which reports CSS pixels
relative to the element, goes the other way as
`(cssX * dpr - offsetX) / scale`. The engine's own pointer already applies that
map, so a game reads positions already converted. See `input.md`.

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

The scale is uniform: the smaller of `cssWidth / logicalWidth` and
`cssHeight / logicalHeight`, multiplied by `dpr`. A single scale preserves the
aspect ratio and keeps the whole logical field visible. The leftover space on
the long axis is split into two equal bars, which are the offsets, computed
against the rounded device size the backing store is written at, so the two bars
sum to the drawable area exactly and neither edge carries a sub-pixel seam.

`syncCanvas` brings the backing store in line with what the surface reports and
returns the fit. The engine calls it at the top of every frame, and once during
construction so the first `viewport()` read and the game's `initialize` see a
real fit. The store is `round(cssWidth * dpr)` by `round(cssHeight * dpr)`,
written only when it differs from the current values, since assigning
`canvas.width` reallocates and clears the canvas.

A degenerate input yields a `scale` of `0` and offsets derived from it: a
container measuring zero on either axis, or a logical size that is not finite and
positive. A ratio that is not finite and positive is read as `1`. A surface
reporting zero leaves the backing store as it stands, keeping the last good frame
on screen; that frame's draws land nothing and the fit recovers on its own once
the element has a size.

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

A canvas styled to follow its container keeps following it; a canvas dropped into
a page that styles nothing settles at its declared attribute size; and a canvas
that exposes no style, such as one driven behind a supplied surface, keeps the
size the surface reports.

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

Every figure the fit is computed from arrives through this seam, and the engine's
key and pointer listeners go on the event target it returns. `origin()` is the
canvas's top-left corner in the client coordinate space pointer events report in,
and it is what the engine subtracts before mapping a pointer position; absent, it
reads `(0, 0)`.

Absent entirely, the engine reads the canvas's `clientWidth`, `clientHeight`, the
owning window's `devicePixelRatio`, and the canvas's bounding rectangle for the
origin, and listens on the canvas's owning document. A supplied surface replaces
every one of those measurements, which is what lets the engine run over a canvas
with no document behind it and gives a check the same transform on every machine.

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

These two pure functions are the whole projection contract. Normalized device
coordinates sit between the two spaces: `ndcX = 2 * logicalX / width - 1` and
`ndcY = 1 - 2 * logicalY / height`.

`projectPoint` maps a world point through the camera's view and perspective
projection into logical coordinates. A point at or behind the camera plane
returns `null` — the cue to skip a label. A visible point maps into
`0..width` × `0..height`; a point outside the frustum maps outside that range and
is returned as-is.

`pointerRay` is the picking convention: `origin` is the camera's position, and
`direction` is the unit vector through the given logical point. A point inside a
letterbox bar is outside the field and still yields a ray, since the math extends
past the field's edge; treating it as a miss is the game's choice. For a point in
front of the camera, `pointerRay(c, v, projectPoint(c, v, p))` passes through `p`.

The pointer stays 2D. The engine hands the game no "3D pointer": mapping a
pointer position into the scene is done by whoever needs it, through
`pointerRay`, and the game intersects the ray with whatever its design picks
against.

```ts
const ray = pointerRay(state.camera, api.viewport(), api.input.pointer());
const t = -ray.origin.y / ray.direction.y;      // where the ray meets y = 0
const aim = vec3Add(ray.origin, vec3Scale(ray.direction, t));
```

## Reading the viewport

`engine.viewport()` and the `viewport()` on each of `InitApi`, `UpdateApi`, and
`RenderApi` return the current fit. Each call returns a snapshot the caller owns,
so a held viewport keeps the values of the frame it was read in.
