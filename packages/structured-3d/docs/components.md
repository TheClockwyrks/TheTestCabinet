# Components

A component is a unit of appearance or behavior attached to exactly one actor
for its lifetime. An actor composes what it looks like, what volume it collides
with, and what it does each frame out of components, and the engine walks them:
enabled components tick in attachment order after their actor, and enabled,
visible render components are collected by the rendering pipeline every frame.

## `Component`

```ts
type ComponentClass<C extends Component = Component> = new (...args: never[]) => C;

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

| Member | Semantics |
| --- | --- |
| `actor` | The actor the component is attached to. Assigned by `attach`, before `beginPlay`. |
| `world` | The world the owning actor belongs to. |
| `offset` | The component's transform relative to its actor's. Defaults to the identity. Mutable in place. |
| `enabled` | Defaults to `true`. A disabled component skips its tick, draws nothing, and takes no part in collision. |
| `beginPlay` | Runs once, after `actor` is assigned. |
| `tick` | Runs once per frame with the frame's delta in seconds, after the owning actor's tick. |
| `endPlay` | Runs once, when the component is detached, when its actor is destroyed, or when the world closes. |
| `worldTransform` | The actor's transform composed with `offset`, as a fresh `Transform` the caller owns. |
| `worldMatrix` | The same composition as a column-major `Mat4`. |

The identity offset is `position {0, 0, 0}`, `rotation {0, 0, 0, 1}`, and
`scale {1, 1, 1}`, so a component drawn without touching `offset` sits exactly
on its actor. The
composition applies scale, then rotation, then translation, and equals
`composeTransforms(actor.transform, offset)`. The base class's `beginPlay`,
`tick`, and `endPlay` do nothing, so a subclass overrides only what it needs.

A component is constructed with whatever arguments its own class takes, then
handed to `actor.attach`. `ComponentClass` is the type `actor.component` and
`actor.componentsOf` select by.

Behavior that belongs to a piece rather than to the whole actor goes in a
component of the game's own, and writing `offset` moves that piece relative to
its actor:

```ts
import { Component, vec3 } from "@test-cabinet/structured-3d";

export class Bob extends Component {
  private elapsed = 0;

  constructor(
    private readonly amplitude: number,
    private readonly period: number,
  ) {
    super();
  }

  override tick(dt: number): void {
    this.elapsed += dt;
    const phase = (this.elapsed / this.period) * Math.PI * 2;
    this.offset.position = vec3(0, Math.sin(phase) * this.amplitude, 0);
  }
}
```

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

| Field | Default | Meaning |
| --- | --- | --- |
| `layer` | `0` | Orders the component's pass. Lower layers draw first. |
| `visible` | `true` | Whether the pipeline collects the component. |
| `opacity` | `1` | Clamped to `0..1`. |
| `space` | Fixed by the class | The pass the component draws in. |

`space` is **read-only and fixed by the class**:

| Space | Components |
| --- | --- |
| `world` | `MeshComponent`, `ModelComponent`, `LightComponent`, `Object3DComponent` |
| `screen` | `SpriteComponent`, `ShapeComponent`, `TextComponent`, `DrawComponent` |

A `world` component is drawn in the world pass, through the camera, as one three
object the pipeline owns and places at the component's world transform. Its
`layer` maps to the object's `renderOrder`, and depth testing decides occlusion.
A `screen` component is drawn in the screen pass, on the screen layer, through
the viewport alone: its composed transform, its sizes, and its font size are
logical units measured from the top-left of the design field, so it holds its
place on the canvas whatever the camera does. The two passes are sorted
separately, and **every `screen` component draws over every `world` one**. See
`rendering.md`.

`visible` takes a component out of the picture and leaves it ticking. The
component's own `enabled` is the wider switch: a disabled component skips its
tick, draws nothing, and takes no part in collision.

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

| Kind | Meaning |
| --- | --- |
| `box` | `width` along X, `height` along Y, `depth` along Z, centered on the transform. |
| `sphere` | A sphere of `radius`, with `segments` subdivisions. `segments` defaults to `24`. |
| `cylinder` | A cylinder along local Y with the two radii and `height`. `segments` defaults to `24`. |
| `capsule` | A capsule of `radius` whose cylindrical part is `height` long along local Y. |
| `plane` | A rectangle in the local XY plane, facing `+Z`. |
| `custom` | The game's own `THREE.BufferGeometry`, drawn as given. |

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

| Field | Default | Meaning |
| --- | --- | --- |
| `kind` | `"standard"` | The material model: physically based, Lambert diffuse, or unlit. |
| `color` | `"#ffffff"` | The base color. |
| `emissive` | `"#000000"` | The emissive color. |
| `metalness` | `0` | The `standard` metalness. |
| `roughness` | `1` | The `standard` roughness. |
| `map` | Unset | A texture sampled as the base color. |
| `opacity` | `1` | Multiplied by the component's `opacity`. |
| `wireframe` | `false` | Whether the material draws as edges. |
| `flatShading` | `false` | Whether faces are shaded flat. |
| `side` | `"front"` | Which faces are drawn. |

A `standard` or `lambert` material takes its shading from the scene's lights, so
a level drawn with either also carries a `LightComponent`. A `basic` material
draws its color as given, which is the choice for a marker or a glow that owes
nothing to the lighting. A texture is loaded through the asset loader before the
component is constructed, so a material reads its `map` as a plain value.

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

| Field | Default | Meaning |
| --- | --- | --- |
| `geometry` | — | The geometry drawn. |
| `material` | Every `MaterialSpec` default | The material drawn with. |
| `billboard` | `false` | `true` turns the mesh to face the camera each frame, keeping its position and scale. |
| `castShadow` | `false` | Whether the mesh casts a shadow. |
| `receiveShadow` | `false` | Whether the mesh receives shadows. |

The pipeline builds one three mesh from `geometry` and `material` and rebuilds
it when either field is **assigned a new value**. Assignment is the change
signal, so mutating a spec's object in place changes nothing — spread the
current spec into a new one:

```ts
override tick(): void {
  const hot = this.world.state.phase === "playing";
  const emissive = hot ? PALETTE.exhaust : "#000000";
  if (this.body.material.emissive !== emissive) {
    this.body.material = { ...this.body.material, emissive };
  }
}
```

Shadows are cast and received only when the engine was created with
`shadows: true` and a light declares `castShadow`.

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

A loaded glTF model placed on an actor. The component clones `model.scene` on
construction, so several components share one loaded model and each animates on
its own. See `models-and-animation.md`.

## `LightSpec` and `LightComponent`

```ts
type LightSpec =
  | { kind: "ambient"; color?: string; intensity?: number }
  | { kind: "hemisphere"; sky?: string; ground?: string; intensity?: number }
  | { kind: "directional"; color?: string; intensity?: number; castShadow?: boolean }
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

class LightComponent extends RenderComponent {
  constructor(options: { light: LightSpec });
  light: LightSpec;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `color` | `"#ffffff"` | The light's color. |
| `intensity` | `1` | The light's intensity. |
| `sky` | `"#ffffff"` | A hemisphere light's color from above. |
| `ground` | `"#444444"` | A hemisphere light's color from below. |
| `distance` | `0` | The range of a point or spot light, in world units. `0` is unbounded. |
| `decay` | `2` | How a point or spot light falls off with distance. |
| `angle` | `π / 3` | A spot light's cone half-angle, in radians. |
| `penumbra` | `0` | The fraction of a spot light's cone that softens to its edge. |
| `castShadow` | `false` | Whether a directional or spot light casts shadows. |

An ambient and a hemisphere light have no position. A point light shines from
the component's world position, and a directional or spot light shines from that
position along its world forward axis, `FORWARD` rotated by the component's
world rotation — so aiming a light is turning the actor or the offset that
carries it.

The pipeline rebuilds the three light when `light` is assigned a new value.
`visible`, `enabled`, and the owning actor's life switch the light with the rest
of the picture, and `opacity` has no effect on it.

## `Object3DComponent`

```ts
class Object3DComponent extends RenderComponent {
  constructor(options: { object: THREE.Object3D });
  readonly object: THREE.Object3D;
}
```

The direct path into the world pass. The subtree under `object` is the game's
own three objects; the pipeline places its root at the component's world
transform every frame and applies `visible` and `opacity` to it. The game
mutates the subtree directly, and the render modes apply to its materials as to
any other.

```ts
import * as THREE from "three";
import { Actor, Object3DComponent } from "@test-cabinet/structured-3d";

export class Plume extends Actor {
  constructor() {
    super();
    const group = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 1.2, 12),
      new THREE.MeshBasicMaterial({ color: "#f5d76e" }),
    );
    cone.rotation.x = Math.PI;
    group.add(cone);
    this.attach(new Object3DComponent({ object: group }));
  }
}
```

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

| Field | Default | Meaning |
| --- | --- | --- |
| `image` | — | The decoded bitmap the component draws. |
| `source` | `null` | A region of a sprite sheet, in the image's pixels. `null` selects the whole image. |
| `width` | The source region's pixel width | The drawn width, in logical units. |
| `height` | The source region's pixel height | The drawn height, in logical units. |
| `anchorX` | `0.5` | The horizontal anchor, as a fraction of the drawn size. |
| `anchorY` | `0.5` | The vertical anchor, as a fraction of the drawn size. |
| `tint` | `null` | A CSS color the image is tinted with. |

A sprite is a **screen** component: it draws on the screen layer in logical
units, which is what a HUD icon and a 2D overlay want. The image is sampled as
`EngineOptions.imageSmoothing` states. A sheet is one image with a `source`
region selecting the frame, and the region is a field the actor writes:

```ts
private elapsed = 0;

override tick(dt: number): void {
  this.elapsed += dt;
  const frame = Math.floor(this.elapsed * 12) % 4;
  this.sprite.source = { x: frame * 16, y: 0, width: 16, height: 16 };
}
```

## `Shape2D` and `ShapeComponent`

```ts
type Shape2D =
  | { kind: "rect"; width: number; height: number }
  | { kind: "circle"; radius: number }
  | { kind: "polygon"; points: readonly Vec2[] };

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

| Field | Default | Meaning |
| --- | --- | --- |
| `shape` | — | The geometry drawn, on the screen layer. |
| `fill` | `null` | A CSS color filled inside the shape. |
| `stroke` | `null` | A CSS color stroked around the outline. |
| `strokeWidth` | `1` | The stroke width, in logical units. |

A rect and a polygon are centered on the component's transform, and a polygon's
points are logical units relative to it. A component with neither a fill nor a
stroke draws nothing, so set at least one. A collider's shape is the volumetric
`ColliderShape` in `collision.md`, a different type.

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

| Field | Default | Meaning |
| --- | --- | --- |
| `text` | — | The string drawn. |
| `font` | `"16px sans-serif"` | A CSS font shorthand. |
| `fill` | `"#ffffff"` | The fill color. |
| `align` | `"center"` | Horizontal alignment against the component's transform. |
| `baseline` | `"middle"` | Vertical alignment against the component's transform. |

The font size is in logical units, so a readout keeps its size on the canvas
whatever the camera does. A scoreboard that shows live figures writes `text`
from a tick:

```ts
import { Actor, TextComponent, vec3 } from "@test-cabinet/structured-3d";
import { LAYER } from "./constants";

export class Scoreboard extends Actor {
  readonly label: TextComponent;

  constructor() {
    super();
    this.label = this.attach(
      new TextComponent({
        text: "0 - 0",
        font: "24px monospace",
        align: "left",
        baseline: "top",
      }),
    );
    this.label.offset.position = vec3(16, 12, 0);
    this.label.layer = LAYER.hud;
  }

  override tick(): void {
    this.label.text = this.world.state.players
      .map((player) => player.score)
      .join(" - ");
  }
}
```

## Screen-space transforms

A `screen` component reads its composed transform as a 2D placement:
`position.x` and `position.y` are logical units from the top-left of the design
field, the rotation is the quaternion's yaw about `+Z`, and `scale.x` and
`scale.y` scale the drawing. `position.z`, `scale.z`, and the quaternion's other
axes play no part in the screen pass.

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

`DrawComponent` is the direct-drawing path onto the screen layer, for a picture
the built-in components cannot state. The engine calls `draw` in the component's
place in the screen pass's layer order, with the context already carrying the
viewport transform, so the component draws in logical units from the top-left of
the design field. A component that draws against the world reads `api.camera()`
and projects world points through `camera.worldToLogical`. Render modes belong
to the declarative pipeline, so a `DrawComponent` reads `api.mode` and supplies
its own. See `rendering.md` for a worked example.

## `CameraComponent`

```ts
class CameraComponent extends Component {
  constructor(options?: { fov?: number });
  fov: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `fov` | `60` | The vertical field of view, in degrees, the camera takes while following. |

An actor carrying a `CameraComponent` is a view target. The world's camera
follows the first enabled one its target holds, at that component's world
position and rotation and its `fov`. Because the offset is composed with the
actor's transform, a chase camera is an offset behind and above the pawn rather
than a second actor. See `camera.md`.

## `ColliderComponent`

A `ColliderComponent` gives its actor a volume the engine tests, positioned and
oriented by the component's world transform. Its options, its channel and
response fields, the manifold a blocking pair reports, and the queries a game
runs against the collision world are specified in `collision.md`.

## Errors

| Condition | Result |
| --- | --- |
| A `beginPlay` throws while the start level is built | `engine.initialize` rejects with the cause |
| A `tick` or a `draw` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
| `ModelComponent.play` is given a name the model lacks | `Error` naming the animation |
