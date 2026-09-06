---
title: Components
---

A component is a unit of appearance or behavior attached to exactly one actor
for its lifetime. An actor composes what it looks like, what shape it collides
with, and what it does each frame out of components, and the engine walks them:
enabled components tick in attachment order after their actor, and enabled,
visible render components are collected by the rendering pipeline every frame.

## `ComponentClass`

```ts
type ComponentClass<C extends Component = Component> = new (
  ...args: never[]
) => C;
```

A component is constructed with whatever arguments its own class takes, then
handed to `actor.attach`. `ComponentClass` is the type `actor.component` and
`actor.componentsOf` select by.

## `Component`

```ts
class Component {
  readonly actor: Actor;
  readonly world: World;
  readonly offset: Transform;
  enabled: boolean;

  beginPlay(): void;
  tick(dt: number): void;
  endPlay(reason: EndPlayReason): void;
  worldTransform(): Transform;
  worldMatrix(): Mat4;
}
```

| Member           | Semantics                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `actor`          | The actor the component is attached to. Assigned by `attach`, before `beginPlay`.                       |
| `world`          | The world the owning actor belongs to.                                                                  |
| `offset`         | The component's transform relative to its actor's. Defaults to the identity. Mutable in place.          |
| `enabled`        | Defaults to `true`. A disabled component skips its tick, draws nothing, and takes no part in collision. |
| `beginPlay`      | Runs once, after `actor` is assigned.                                                                   |
| `tick`           | Runs once per frame with the frame's delta in seconds, after the owning actor's tick.                   |
| `endPlay`        | Runs once, when the component is detached, when its actor is destroyed, or when the world closes.       |
| `worldTransform` | The actor's transform composed with `offset`, as a fresh `Transform` the caller owns.                   |
| `worldMatrix`    | The same composition as a column-major `Mat4`.                                                          |

The identity offset is `{ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0,
z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }`, so a component drawn without
touching `offset` sits exactly on its actor. The composition applies scale, then
rotation, then translation, as three composes a matrix, and equals
`composeTransforms(actor.transform, offset)` from the
[math](/engines/structured-3d/apis/math/) module. The base class's `beginPlay`,
`tick`, and `endPlay` do nothing, so a subclass overrides only what it needs.

## `RenderComponent`

```ts
type RenderSpace = "world" | "screen";

class RenderComponent extends Component {
  layer: number;
  visible: boolean;
  opacity: number;
  readonly space: RenderSpace;
}
```

| Field     | Default            | Meaning                                               |
| --------- | ------------------ | ----------------------------------------------------- |
| `layer`   | `0`                | Orders the component's pass. Lower layers draw first. |
| `visible` | `true`             | Whether the pipeline collects the component.          |
| `opacity` | `1`                | Clamped to `0..1`.                                    |
| `space`   | Fixed by the class | The space the component draws in.                     |

`RenderComponent` is the base every drawing component extends. `space` is
read-only and fixed by the component's class: `MeshComponent`,
`ModelComponent`, `LightComponent`, and `Object3DComponent` are `world`
components, and `SpriteComponent`, `ShapeComponent`, `TextComponent`, and
`DrawComponent` are `screen` components.

A `world` component is drawn in the world pass, through the camera, as one
three object the pipeline owns and places at the component's world transform.
Its `layer` maps to the object's `renderOrder`, which orders draws within the
same transparency pass, and depth testing decides occlusion. A `screen`
component is drawn in the screen pass, on the screen layer, through the
viewport alone: its composed transform, its sizes, and its font size are
logical units measured from the top-left of the design field, so it holds its
place on the canvas whatever the camera does. The two passes are sorted
separately, and every `screen` component draws over every `world` one. See
[rendering](/engines/structured-3d/apis/rendering/).

## `MeshGeometry`

```ts
type MeshGeometry =
  | { kind: "box"; width: number; height: number; depth: number }
  | { kind: "sphere"; radius: number; segments?: number }
  | {
      kind: "cylinder";
      radiusTop: number;
      radiusBottom: number;
      height: number;
      segments?: number;
    }
  | { kind: "capsule"; radius: number; height: number }
  | { kind: "plane"; width: number; height: number }
  | { kind: "custom"; geometry: THREE.BufferGeometry };
```

| Kind       | Meaning                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `box`      | A box of `width` along `X`, `height` along `Y`, and `depth` along `Z`, centered on the transform.                      |
| `sphere`   | A sphere of `radius`, with `segments` subdivisions. `segments` defaults to `24`.                                       |
| `cylinder` | A cylinder along local `Y` with the two radii and `height`, with `segments` subdivisions. `segments` defaults to `24`. |
| `capsule`  | A capsule of `radius` whose cylindrical part is `height` long along local `Y`.                                         |
| `plane`    | A rectangle in the local `XY` plane, facing `+Z`.                                                                      |
| `custom`   | The game's own `THREE.BufferGeometry`, drawn as given.                                                                 |

Every geometry is centered on the component's transform, and every dimension is
in world units.

## `MaterialSpec`

```ts
interface MaterialSpec {
  kind?: "standard" | "lambert" | "basic";
  color?: string;
  emissive?: string;
  metalness?: number;
  roughness?: number;
  map?: THREE.Texture;
  opacity?: number;
  wireframe?: boolean;
  flatShading?: boolean;
  side?: "front" | "back" | "double";
}
```

| Field         | Default      | Meaning                                                          |
| ------------- | ------------ | ---------------------------------------------------------------- |
| `kind`        | `"standard"` | The material model: physically based, Lambert diffuse, or unlit. |
| `color`       | `"#ffffff"`  | The base color.                                                  |
| `emissive`    | `"#000000"`  | The emissive color.                                              |
| `metalness`   | `0`          | The `standard` metalness.                                        |
| `roughness`   | `1`          | The `standard` roughness.                                        |
| `map`         | Unset        | A texture sampled as the base color.                             |
| `opacity`     | `1`          | Multiplied by the component's `opacity`.                         |
| `wireframe`   | `false`      | Whether the material draws as edges.                             |
| `flatShading` | `false`      | Whether faces are shaded flat.                                   |
| `side`        | `"front"`    | Which faces are drawn.                                           |

A texture is loaded through the [assets](/engines/structured-3d/apis/assets/)
loader before the component is constructed, so a material reads its map as a
plain value.

## `MeshComponent`

```ts
class MeshComponent extends RenderComponent {
  constructor(options: {
    geometry: MeshGeometry;
    material?: MaterialSpec;
    billboard?: boolean;
  });
  geometry: MeshGeometry;
  material: MaterialSpec;
  billboard: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}
```

| Field           | Default                      | Meaning                                              |
| --------------- | ---------------------------- | ---------------------------------------------------- |
| `geometry`      | —                            | The geometry drawn.                                  |
| `material`      | Every `MaterialSpec` default | The material drawn with.                             |
| `billboard`     | `false`                      | `true` turns the mesh to face the camera each frame. |
| `castShadow`    | `false`                      | Whether the mesh casts a shadow.                     |
| `receiveShadow` | `false`                      | Whether the mesh receives shadows.                   |

The pipeline builds one three mesh from `geometry` and `material` and rebuilds
it when either field is assigned a new value. Assignment is the change signal,
so a game that mutates a spec's object reassigns the field afterwards. A
billboard keeps its position and scale from the world transform and takes its
orientation from the camera. Shadows are cast and received when
[`EngineOptions.shadows`](/engines/structured-3d/apis/engine/) is `true` and a
light declares `castShadow`.

## `ModelComponent`

```ts
interface NodeHandle {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

class ModelComponent extends RenderComponent {
  constructor(options: { model: Model; animation?: string });
  readonly model: Model;
  castShadow: boolean;
  receiveShadow: boolean;
  time: number;

  play(animation: string, options?: { loop?: boolean; speed?: number }): void;
  stop(): void;
  animation(): string | null;
  node(name: string): NodeHandle | null;
}
```

| Member          | Semantics                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `model`         | The loaded model the component was built from.                                                       |
| `castShadow`    | Defaults to `false`. Whether the model's meshes cast shadows.                                        |
| `receiveShadow` | Defaults to `false`. Whether the model's meshes receive shadows.                                     |
| `time`          | Seconds into the playing animation. Writable, so a game seeks.                                       |
| `play`          | Plays the named clip. `loop` defaults to `true` and `speed` to `1`, a multiplier on the clip's rate. |
| `stop`          | Stops the playing clip.                                                                              |
| `animation`     | The name of the playing clip, or `null`.                                                             |
| `node`          | A live handle onto the named node's local transform, or `null` for a name the model lacks.           |

The component clones `model.scene` on construction, and a skinned mesh in the
clone keeps its own skeleton, so several components share one loaded model. An
`animation` given at construction is played looping from the first frame. Clips
play through a three `AnimationMixer` advanced by the world's delta, so a paused
world advances none, and a clip played with `loop: false` plays once and holds
its final pose. A `NodeHandle` is a live view onto one node of the clone, and
writing its fields poses that node directly, which is how a game drives a joint
the voxel exporter named. `model.nodes` lists every name `node` accepts.

## `LightSpec`

```ts
type LightSpec =
  | { kind: "ambient"; color?: string; intensity?: number }
  | { kind: "hemisphere"; sky?: string; ground?: string; intensity?: number }
  | {
      kind: "directional";
      color?: string;
      intensity?: number;
      castShadow?: boolean;
    }
  | {
      kind: "point";
      color?: string;
      intensity?: number;
      distance?: number;
      decay?: number;
    }
  | {
      kind: "spot";
      color?: string;
      intensity?: number;
      angle?: number;
      penumbra?: number;
      distance?: number;
      decay?: number;
      castShadow?: boolean;
    };
```

| Field        | Default     | Meaning                                                               |
| ------------ | ----------- | --------------------------------------------------------------------- |
| `color`      | `"#ffffff"` | The light's color.                                                    |
| `intensity`  | `1`         | The light's intensity.                                                |
| `sky`        | `"#ffffff"` | A hemisphere light's color from above.                                |
| `ground`     | `"#444444"` | A hemisphere light's color from below.                                |
| `distance`   | `0`         | The range of a point or spot light, in world units. `0` is unbounded. |
| `decay`      | `2`         | How a point or spot light falls off with distance.                    |
| `angle`      | `π / 3`     | A spot light's cone half-angle, in radians.                           |
| `penumbra`   | `0`         | The fraction of a spot light's cone that softens to its edge.         |
| `castShadow` | `false`     | Whether a directional or spot light casts shadows.                    |

An ambient and a hemisphere light have no position. A point light shines from
the component's world position, and a directional or spot light shines from the
component's world position along its world forward axis, `FORWARD` rotated by
the component's world rotation.

## `LightComponent`

```ts
class LightComponent extends RenderComponent {
  constructor(options: { light: LightSpec });
  light: LightSpec;
}
```

The pipeline builds one three light from `light` and rebuilds it when the field
is assigned a new value. A `LightComponent` is a `world` component, so
`visible`, `enabled`, and the owning actor's life switch the light with the
rest of the picture, and `opacity` has no effect on it.

## `Object3DComponent`

```ts
class Object3DComponent extends RenderComponent {
  constructor(options: { object: THREE.Object3D });
  readonly object: THREE.Object3D;
}
```

`Object3DComponent` is the direct path into the world pass. The subtree under
`object` is the game's own three objects, and the pipeline places its root at
the component's world transform every frame and applies `visible` and `opacity`
to it. The game mutates the subtree directly, and the render modes apply to its
materials as to any other.

## `SpriteComponent`

```ts
interface SpriteOptions {
  image: ImageBitmap;
  source?: Rect;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  tint?: string;
}

class SpriteComponent extends RenderComponent {
  constructor(options: SpriteOptions);
  image: ImageBitmap;
  source: Rect | null;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  tint: string | null;
}
```

| Field     | Default                          | Meaning                                                     |
| --------- | -------------------------------- | ----------------------------------------------------------- |
| `image`   | —                                | The decoded bitmap the component draws.                     |
| `source`  | `null`                           | A region of a sprite sheet. `null` selects the whole image. |
| `width`   | The source region's pixel width  | The drawn width, in logical units.                          |
| `height`  | The source region's pixel height | The drawn height, in logical units.                         |
| `anchorX` | `0.5`                            | The horizontal anchor, as a fraction of the drawn size.     |
| `anchorY` | `0.5`                            | The vertical anchor, as a fraction of the drawn size.       |
| `tint`    | `null`                           | A CSS color the image is tinted with.                       |

The anchor defaults center the sprite on its transform. An image is loaded
through the [assets](/engines/structured-3d/apis/assets/) loader before the
component is constructed, so a sprite reads its bitmap as a plain value.

The image is sampled as `EngineOptions.imageSmoothing` states: bilinearly by
default, nearest-neighbor when it is `false`. See
[rendering](/engines/structured-3d/apis/rendering/).

## `Shape2D`

```ts
type Shape2D =
  | { kind: "rect"; width: number; height: number }
  | { kind: "circle"; radius: number }
  | { kind: "polygon"; points: readonly Vec2[] };
```

A rect and a polygon are centered on the component's transform, and a polygon's
points are logical units relative to it. A collider's shape is the volumetric
`ColliderShape` under [collision](/engines/structured-3d/apis/collision/).

## `ShapeComponent`

```ts
interface ShapeOptions {
  shape: Shape2D;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

class ShapeComponent extends RenderComponent {
  constructor(options: ShapeOptions);
  shape: Shape2D;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}
```

| Field         | Default | Meaning                                 |
| ------------- | ------- | --------------------------------------- |
| `shape`       | —       | The geometry drawn.                     |
| `fill`        | `null`  | A CSS color filled inside the shape.    |
| `stroke`      | `null`  | A CSS color stroked around the outline. |
| `strokeWidth` | `1`     | The stroke width, in logical units.     |

A component with neither a fill nor a stroke draws nothing.

## `TextComponent`

```ts
interface TextOptions {
  text: string;
  font?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
}

class TextComponent extends RenderComponent {
  constructor(options: TextOptions);
  text: string;
  font: string;
  fill: string;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
}
```

| Field      | Default             | Meaning                                                 |
| ---------- | ------------------- | ------------------------------------------------------- |
| `text`     | —                   | The string drawn.                                       |
| `font`     | `"16px sans-serif"` | A CSS font shorthand.                                   |
| `fill`     | `"#ffffff"`         | The fill color.                                         |
| `align`    | `"center"`          | Horizontal alignment against the component's transform. |
| `baseline` | `"middle"`          | Vertical alignment against the component's transform.   |

The font size is in logical units, so a readout keeps its size on the canvas
whatever the camera does.

## `DrawComponent`

```ts
interface DrawApi {
  readonly ctx: CanvasRenderingContext2D;
  readonly mode: RenderMode;
  frame(): FrameInfo;
  viewport(): Viewport;
  camera(): CameraSnapshot;
}

abstract class DrawComponent extends RenderComponent {
  abstract draw(api: DrawApi): void;
}
```

| Member     | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `ctx`      | The screen layer's 2D context, already carrying the viewport transform.         |
| `mode`     | The render mode in force for this frame.                                        |
| `frame`    | The frame counter, the accumulated simulated time, and the most recent delta.   |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns.               |
| `camera`   | The camera's pose and projection for this frame, as a snapshot the caller owns. |
| `draw`     | Called in the component's place in the screen pass's layer order.               |

`DrawComponent` is the direct-drawing path onto the screen layer, for a case
that measures the drawing itself. The context already carries the viewport
transform, so the component draws in logical units from the top-left of the
design field, and `camera()` together with the
[camera's](/engines/structured-3d/apis/camera/) `worldToLogical` places a world
point under its pen. Render modes belong to the declarative pipeline, so a
`DrawComponent` reads `api.mode` and supplies its own.

## Screen-space transforms

A `screen` component reads its composed transform, its actor's transform with
its `offset`, as a 2D placement: `position.x` and `position.y` are logical units
from the top-left of the design field, the rotation is the quaternion's yaw
about `+Z`, and `scale.x` and `scale.y` scale the drawing. `position.z`,
`scale.z`, and the quaternion's other axes play no part in the screen pass.

## `CameraComponent`

```ts
class CameraComponent extends Component {
  constructor(options?: { fov?: number });
  fov: number;
}
```

| Field | Default | Meaning                                                                   |
| ----- | ------- | ------------------------------------------------------------------------- |
| `fov` | `60`    | The vertical field of view, in degrees, the camera takes while following. |

An actor carrying a `CameraComponent` is a view target. The world's
[camera](/engines/structured-3d/apis/camera/) follows the first enabled one it
holds, at that component's world position and rotation and its `fov`.

## `ColliderComponent`

A `ColliderComponent` gives its actor a volume the engine tests, positioned and
oriented by the component's world transform. Its options, its channel and
response fields, the manifold a blocking pair reports, and the queries a game
runs against the collision world are specified under
[collision](/engines/structured-3d/apis/collision/).

## Errors

| Condition                                             | Result                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| A `beginPlay` throws while the start level is built   | `engine.initialize` rejects with the cause                              |
| A `tick` or a `draw` throws under `run`               | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance`           | `advance` rejects with the cause, and the remaining frames do not run   |
| `ModelComponent.play` is given a name the model lacks | `Error` naming the animation                                            |

A throw under `run` leaves the loop alive, so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.

## Exports

`Component`, `RenderComponent`, `MeshComponent`, `ModelComponent`,
`LightComponent`, `Object3DComponent`, `SpriteComponent`, `ShapeComponent`,
`TextComponent`, `DrawComponent`, `CameraComponent`, and `ColliderComponent` are
exported as classes from `@clockwyrks/structured-3d`. `ComponentClass`,
`RenderSpace`, `MeshGeometry`, `MaterialSpec`, `NodeHandle`, `LightSpec`,
`Model`, `SpriteOptions`, `Shape2D`, `ShapeOptions`, `TextOptions`, `DrawApi`,
`ColliderOptions`, `Vec2`, `Vec3`, `Quat`, `Mat4`, and `Rect` are exported as
types from the same entry point.
