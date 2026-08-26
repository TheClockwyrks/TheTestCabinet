# Components

A component is a unit of appearance or behavior attached to exactly one actor
for its lifetime. An actor composes what it looks like, what shape it collides
with, what lights it carries, and what it does each frame out of components, and
the engine walks them: enabled components tick in attachment order after their
actor, and enabled, visible render components are collected by the rendering
pipeline every frame.

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
}
```

| Member | Semantics |
| --- | --- |
| `actor` | The actor the component is attached to. Assigned by `attach`, before `beginPlay`. |
| `world` | The world the owning actor belongs to. |
| `offset` | The component's transform relative to its actor's. Defaults to the identity. |
| `enabled` | Defaults to `true`. A disabled component skips its tick, draws nothing, and takes no part in collision. |
| `beginPlay` | Runs once, after `actor` is assigned. |
| `tick` | Runs once per frame with the frame's delta in seconds, after the owning actor's tick. |
| `endPlay` | Runs once, when the component is detached, when its actor is destroyed, or when the world closes. |
| `worldTransform` | The actor's transform composed with `offset`, as a snapshot the caller owns. |

The identity offset is position `(0, 0, 0)`, identity rotation, and scale `(1,
1, 1)`, so a component drawn without touching `offset` sits exactly on its
actor. The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a
subclass overrides only what it needs.

`worldTransform()` composes the two in TRS order:

- `position` is `transformPoint(actor.transform, offset.position)`
- `rotation` is `quatMultiply(actor.transform.rotation, offset.rotation)`
- `scale` is the componentwise product of the two scales

A component is constructed with whatever arguments its own class takes, then
handed to `actor.attach`. `ComponentClass` is the type `actor.component` and
`actor.componentsOf` select by.

Behavior that belongs to a piece rather than to the whole actor goes in a
component of the game's own:

```ts
import { Component } from "@test-cabinet/structured-3d";

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
    this.offset.position.y = Math.sin(phase) * this.amplitude;
  }
}
```

Writing `offset` moves the component relative to its actor, so a pickup bobs
while its actor stays where the level placed it.

## `RenderComponent`

```ts
class RenderComponent extends Component {
  layer: number;
  visible: boolean;
  opacity: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `layer` | `0` | Orders the pipeline. Lower layers draw first, and the depth buffer is cleared between layers. |
| `visible` | `true` | Whether the pipeline collects the component. |
| `opacity` | `1` | Clamped to `0..1`. A component below `1` draws in its layer's transparent pass. |

`RenderComponent` is the base every drawing component extends. The pipeline
sorts the collection by `layer` ascending, then by the owning actor's spawn
order, then by attachment order, and the sort is stable, so a redraw with no
change reproduces the previous order exactly. See `rendering.md` for the layer
passes and the transparent pass.

`visible` takes a component out of the picture and leaves it ticking. The
component's own `enabled` is the wider switch: a disabled component skips its
tick, draws nothing, and takes no part in collision.

## `MeshComponent`

```ts
interface MeshOptions {
  mesh: MeshHandle;
  material?: MaterialHandle;
  color?: Color;
  clip?: string;
  clipTime?: number;
}

class MeshComponent extends RenderComponent {
  constructor(options: MeshOptions);
  mesh: MeshHandle;
  material: MaterialHandle | null;
  color: Color | null;
  clip: string | null;
  clipTime: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `mesh` | — | The loaded mesh the component draws, at the component's world transform. |
| `material` | `null` | A material applied over every surface of the mesh. `null` draws the materials the mesh file carries. |
| `color` | `null` | A CSS color multiplied onto the base color, the 3D tint. |
| `clip` | `null` | The animation clip posing the mesh, a name from `mesh.clips`. `null` draws the bind pose. |
| `clipTime` | `0` | Seconds into the clip the pose is sampled at. Wraps at the clip's duration. |

The mesh's local units are scaled by the world transform's scale. A mesh is
loaded through the asset loaders before the component is constructed — a level's
`load` is awaited before any of its actors exist — so the component reads its
handle as a plain value. See `assets.md`.

The pose is a pure function of `clip` and `clipTime`, and **the engine never
advances `clipTime`**: a game animates by advancing it in a tick, so the pose is
readable state and a scripted run reproduces it exactly.

```ts
override tick(dt: number): void {
  this.body.clipTime += dt * this.playRate;
}
```

## `Shape3`

```ts
type Shape3 =
  | { kind: "box"; size: Vec3 }
  | { kind: "sphere"; radius: number }
  | { kind: "capsule"; radius: number; height: number };
```

Every shape is centered on the component's world transform and oriented by that
transform's rotation. A box's `size` is its full extent per axis. A capsule's
axis runs along the component's local +Y, and `height` is the distance between
the centers of its two hemispherical caps, so the total extent along the axis is
`height + 2 * radius`. The same type describes a drawn shape and a collider's
shape.

Scale applies per axis to a box's `size`. A sphere's radius, and a capsule's
radius, scale by the largest of the three scale factors' magnitudes, and a
capsule's `height` scales by the y factor.

## `ShapeComponent`

```ts
interface ShapeOptions {
  shape: Shape3;
  color?: Color;
  material?: MaterialHandle;
}

class ShapeComponent extends RenderComponent {
  constructor(options: ShapeOptions);
  shape: Shape3;
  color: Color;
  material: MaterialHandle | null;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `shape` | — | The primitive drawn. |
| `color` | `"#ffffff"` | The surface's base color. |
| `material` | `null` | A material applied over the primitive. Its maps multiply with `color`. |

Each primitive carries its own texture parameterization; a case that must assert
on exact texel placement uses a `MeshComponent` with authored coordinates
instead.

## `TextComponent`

```ts
interface TextOptions {
  text: string;
  font?: string;
  fill?: Color;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
}

class TextComponent extends RenderComponent {
  constructor(options: TextOptions);
  text: string;
  font: string;
  fill: Color;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `text` | — | The string drawn. |
| `font` | `"16px monospace"` | A CSS font shorthand. Only the **size** is read, as world units of text height; the face is always the engine's own monospace face, so the same string letters the same in every build and in the player. |
| `fill` | `"#ffffff"` | The fill color. |
| `align` | `"center"` | Horizontal alignment against the component's transform. |
| `baseline` | `"middle"` | Vertical alignment against the component's transform. |

The text draws as a **billboard**: a quad at the component's world position that
always faces the camera, positioned against the transform by `align` and
`baseline`. The billboard ignores the component's rotation, and the transform's
x and y scale factors scale the quad. Text draws unlit in every render mode
except `wireframe`, where its quad's outline draws in `fill`.

A scoreboard that shows live figures writes `text` from a tick:

```ts
export class Scoreboard extends Actor {
  readonly label: TextComponent;

  constructor() {
    super();
    this.label = this.attach(
      new TextComponent({ text: "0 - 0", font: "24px monospace" }),
    );
    this.label.layer = LAYER.hud;
  }

  override tick(): void {
    const scores = this.world.state.players.map((player) => player.score);
    this.label.text = scores.join(" - ");
  }
}
```

## `DrawComponent`

```ts
interface DrawApi {
  readonly scene: SceneContext;
  readonly mode: RenderMode;
  frame(): FrameInfo;
  viewport(): Viewport;
  camera(): CameraState;
}

abstract class DrawComponent extends RenderComponent {
  abstract draw(api: DrawApi): void;
}
```

| Member | Meaning |
| --- | --- |
| `scene` | The scene context the pipeline draws through, with this frame's camera, lights, and mode already in force. |
| `mode` | The render mode in force for this frame. |
| `frame` | The frame counter, the accumulated simulated time, and the most recent delta. |
| `viewport` | The current logical-to-device fit, as a snapshot the caller owns. |
| `camera` | The camera's state for this frame, as a `CameraState` the caller owns. |
| `draw` | Called in the component's place in the layer order. |

`DrawComponent` is the direct-drawing path, for a picture the built-in
components cannot state. The component issues scene-context draw calls in world
units, under the mode already in force, so nothing needs implementing per mode;
`api.mode` stays readable for a component that draws differently under one.

A `DrawComponent` does **not** set the scene context's camera, lights, or mode,
and does not clear depth: those belong to the pipeline, and a call to
`setCamera`, `setLights`, `setMode`, or `clearDepth` from `draw` throws, naming
the rule. The vocabulary itself, and a worked example, are in `rendering.md`.

## `CameraComponent`

```ts
class CameraComponent extends Component {
  constructor(options?: { fovY?: number });
  fovY: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `fovY` | `Math.PI / 3` | The vertical field of view the camera takes while following, in radians. |

An actor carrying a `CameraComponent` is a view target. The world's camera
follows the first enabled one its target holds, adopting that component's world
position and rotation and its `fovY`; `near` and `far` stay the camera's own.
See `camera.md`.

## Light components

```ts
interface LightOptions {
  color?: Color;
  intensity?: number;
}

interface PointLightOptions extends LightOptions {
  range?: number;
}

abstract class LightComponent extends Component {
  color: Color;
  intensity: number;
}

class AmbientLightComponent extends LightComponent {
  constructor(options?: LightOptions);
}

class DirectionalLightComponent extends LightComponent {
  constructor(options?: LightOptions);
}

class PointLightComponent extends LightComponent {
  constructor(options?: PointLightOptions);
  range: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `color` | `"#ffffff"` | The light's color. |
| `intensity` | `1` | The light's strength. Non-negative. |
| `PointLightComponent.range` | `0` | The distance the light reaches, in world units. `0` reaches everywhere. |

Lighting is world content: a light is a component on an actor, so it moves with
its actor, is collected while it is enabled and its actor alive, and is rebuilt
with the world like everything else. An ambient light lights every surface
evenly from nowhere. A directional light shines along the component's world
orientation applied to local −Z — the direction a camera looks — so an actor
aims a light by rotating. A point light shines from the component's world
position, falling off to nothing at `range`; its `range` is world units,
unscaled by the transform.

```ts
export class Sun extends Actor {
  constructor() {
    super();
    this.attach(new DirectionalLightComponent({ intensity: 0.9 }));
    this.transform.rotation = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 4);
  }
}
```

Each frame the pipeline snapshots the enabled lights, in the owning actors'
spawn order and then attachment order, into the renderer state's `lights` list
as `LightState` values: an ambient as `{ type: "ambient", color, intensity }`, a
directional as `{ type: "directional", color, intensity, direction }` with
`direction` the unit world vector computed from the component's world rotation,
and a point as `{ type: "point", color, intensity, position, range }` with
`position` the component's world position.

A world holding **no** enabled light component is lit by the engine's default
rig: one ambient light, `#ffffff` at intensity `0.4`, and one directional light,
`#ffffff` at intensity `0.8`, direction `vec3Normalize({ x: -1, y: -2, z: -1
})`. The rig appears in the renderer state and so in a recording as those two
`LightState` entries, so a recording states what lit it, and it withdraws on any
frame the world holds an enabled light component.

## `ColliderComponent`

A `ColliderComponent` gives its actor a shape the engine tests, positioned and
oriented by the component's world transform. Its options, its channel and
response fields, the manifold a blocking pair reports, and the queries a game
runs against the collision world are specified in `collision.md`.

## Errors

| Condition | Result |
| --- | --- |
| A `beginPlay` throws while the start level is built | `engine.initialize` rejects with the cause |
| A `tick` or a `draw` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
| A `MeshComponent` drawn with a `clip` its mesh does not carry | The draw throws, naming the clip and the clips the mesh carries |
| `setCamera`, `setLights`, `setMode`, or `clearDepth` called from a `DrawComponent`'s `draw` | `Error` naming the rule |
