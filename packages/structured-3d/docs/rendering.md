# Rendering

The engine owns rendering, over WebGL2. A game configures what to draw by
attaching render components to its actors, and the pipeline collects them,
orders them, and draws them once per frame. The game never writes a shader and
never touches the WebGL context. `components.md` covers what each built-in
component draws; this page covers the pipeline that draws them and the
vocabulary a `DrawComponent` draws through.

## The pipeline

Each frame, after the ticks and after any transition:

1. The camera is updated: a world following a view target adopts that target's
   first enabled `CameraComponent`'s world position and rotation and its `fovY`.
2. The renderer state is set on the scene context: the mode, the camera's
   `CameraState`, and the lights collected from the enabled light components on
   live actors, in spawn order then attachment order — or the default rig when
   there are none.
3. The canvas is cleared to `background` (transparency when none was given) and
   the depth state is reset. The viewport letterboxes the logical field onto
   the canvas; the renderer draws inside the fit and the bars are cleared
   outside the picture.
4. The engine collects every enabled, visible `RenderComponent` on every live
   actor.
5. The collection is sorted by `layer` ascending, then by the owning actor's
   spawn order, then by attachment order. The sort is stable.
6. The layers draw in ascending order, and the depth buffer is cleared before
   each layer — issued through the scene context as `clearDepth`, so a recording
   carries the clear — which is what lets a later layer draw over an earlier one
   however near the earlier one's geometry sits. Within a layer, components at
   opacity `1` draw in sort order with the depth buffer ordering their
   fragments; components below opacity `1` draw afterwards, farthest from the
   camera first (by their world positions' distance to the camera, ties broken
   by the sort order). A `DrawComponent` receives `DrawApi` and draws itself in
   its place.
7. The collision overlay draws, when it is enabled: every enabled collider's
   shape as outlines over the finished picture, in a color per response. It
   draws through the scene context as a `clearDepth` followed by `drawLine`
   outlines, so nothing the game drew hides it and a recording replays it
   exactly.
8. The debug overlay draws on the engine's own overlay surface, in device space,
   above the rendering canvas.

Step 4 reads `enabled` from the component and `visible` from its
`RenderComponent` fields, so a component leaves the picture the moment either is
cleared. A destroyed actor stops rendering immediately, before the end-of-frame
flush removes it from the world.

## The sort and the layers

The sort key is `layer` ascending, then the owning actor's spawn order, then
attachment order within that actor. `layer` defaults to `0`. The sort is stable,
and two components sharing a layer, an actor, and an attachment position cannot
exist, so the order is total and a frame is reproducible from the world alone.

Within a layer the depth buffer orders opaque fragments, so components that
occupy the same space resolve by depth rather than by order, and the sort
decides the remaining ties. **Between** layers the depth buffer is cleared,
which is the HUD idiom: a 3D scene on layer `0` and a billboard `TextComponent`
score on layer `1` draw the score over the scene whatever geometry sits between
them.

Number the layers in one place, leave gaps between them, and give every
component a layer from that table rather than a literal:

```ts
export const LAYER = { scene: 0, effects: 10, hud: 20 } as const;
```

## `RenderMode`

```ts
type RenderMode = "standard" | "wireframe" | "unlit" | "normals";
```

| Mode | Draws |
| --- | --- |
| `standard` | The full picture: materials and colors lit by the lights, tint, and opacity. The default. |
| `wireframe` | Each component's geometry as its triangle edges alone, unlit, at one stroke width, in the component's color (`#ffffff` for a component whose color is `null`). |
| `unlit` | Base colors and textures at full brightness and full opacity, with lighting and every tint dropped. |
| `normals` | Each pixel colored by its world-space surface normal, mapped as `rgb = (n + 1) / 2`. |

The mode belongs to the pipeline and applies to every draw of the frame,
scene-context draws from a `DrawComponent` included, so every game has all four
modes without implementing any of them. The mode governs mesh and geometry
draws; billboards, lines, and HUD draws render the same under every mode.

## `Renderer`

```ts
interface Renderer {
  mode(): RenderMode;
  setMode(mode: RenderMode): void;
  collisionOverlay(): boolean;
  setCollisionOverlay(enabled: boolean): void;
}
```

| Member | Effect |
| --- | --- |
| `mode` | The mode in force, `standard` until it is set. |
| `setMode` | Sets the mode. The next frame the pipeline runs draws under it. |
| `collisionOverlay` | Whether the collision overlay draws. |
| `setCollisionOverlay` | Turns the collision overlay on or off. |

The renderer is reached as `engine.renderer` and is available from construction,
so whoever holds the engine drives both switches:

```ts
engine.renderer.setMode("wireframe");
engine.renderer.setCollisionOverlay(true);
```

The collision overlay draws every enabled collider's shape over the finished
picture and is independent of the mode. Its color states the strongest response
the collider's own `responses` declare: `#ff4040` for a collider that declares a
`block` answer, `#40ff40` for one whose strongest answer is `overlap`, and
`#808080` for one that declares neither. See `collision.md`.

## The scene context

`SceneContext` is the whole drawing vocabulary — the same one Simple 3D games
render through, shared verbatim, so both engines' recordings replay in one
player. The pipeline issues it; a `DrawComponent` issues the draw calls and the
producers within it.

```ts
interface SceneContext {
  setCamera(camera: CameraState): void;
  setLights(lights: readonly LightState[]): void;
  setMode(mode: RenderMode): void;

  clearDepth(): void;

  drawMesh(mesh: MeshHandle, transform: Transform, options?: DrawMeshOptions): void;
  drawGeometry(geometry: Geometry, material: MaterialLike, transform: Transform): void;
  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void;
  drawLine(points: readonly Vec3[], color: Color): void;
  drawHudText(text: string, position: Vec2, options?: HudTextOptions): void;
  drawHudRect(position: Vec2, size: Vec2, color: Color): void;

  createBox(size: Vec3): Geometry;
  createSphere(radius: number): Geometry;
  createCylinder(radius: number, height: number): Geometry;
  createCapsule(radius: number, height: number): Geometry;
  createPlane(width: number, depth: number): Geometry;
  createMaterial(spec: MaterialSpec): Material;
}
```

| Member | Intent |
| --- | --- |
| `setCamera` / `setLights` / `setMode` | The renderer state. **The pipeline's alone** — see the rule below. |
| `clearDepth` | Clears the depth buffer where it stands in the issue order. The pipeline's alone. |
| `drawMesh` | Draws a loaded mesh under a world transform, with its file's own materials unless overridden. |
| `drawGeometry` | Draws a procedural geometry under a world transform with the given material. |
| `drawBillboard` | Draws a camera-facing, unlit, alpha-blended quad of `size` world units centered at `position`. |
| `drawLine` | Draws a connected world-space polyline, one device pixel wide. Fewer than two points draws nothing. |
| `drawHudText` | Draws text in logical design coordinates, composited above the 3D picture. |
| `drawHudRect` | Fills an axis-aligned rectangle in logical design coordinates, composited above the 3D picture. |
| `createBox` | A box of `size` world units, centered at the local origin. |
| `createSphere` | A sphere of `radius`, centered at the local origin, tessellated at 32×16 segments. |
| `createCylinder` | A capped cylinder of `radius` and `height` on the local Y axis, centered, 32 radial segments. |
| `createCapsule` | A capsule of `radius` on the local Y axis, centered; `height` is the distance between the caps' centers, so the extent along the axis is `height + 2 * radius`. |
| `createPlane` | A `width`×`depth` plane on the local XZ plane, +Y normal, centered. |
| `createMaterial` | A material built in code from a `MaterialSpec`. |

Every draw call is self-contained, naming its full world transform or position
explicitly, and no method reads anything back: there is no transform stack, no
`save`/`restore`, and no getters. A produced `Geometry` or `Material` is
immutable and creation is deterministic, so creating one per frame inside `draw`
is idiomatic — two calls with the same arguments share one entry in a recording
— and holding one in module scope is equally fine.

```ts
type MaterialLike = MaterialHandle | Material | Color;

interface MaterialSpec {
  baseColor?: Color;
  baseColorMap?: TextureHandle;
  normalMap?: TextureHandle;
  roughness?: number;
  metallic?: number;
  emissive?: Color;
  opacity?: number;
  unlit?: boolean;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `baseColor` | `"#ffffff"` | The base color, multiplied with `baseColorMap` where one is given. |
| `baseColorMap` | — | The base color texture. |
| `normalMap` | — | The tangent-space normal texture. |
| `roughness` | `0.8` | Surface roughness, `0`–`1`. |
| `metallic` | `0` | Metalness, `0`–`1`. |
| `emissive` | `"#000000"` | The emissive color, unaffected by lights. |
| `opacity` | `1` | `0`–`1`; below `1` the material is translucent and its draws blend. |
| `unlit` | `false` | `true` renders the base color and map without lighting. |

A `Color` string stands in for a whole material where the defaults suit — a
standard lit material with that base color — and a `MaterialHandle` loaded from
a produced material document slots into the same argument. `Geometry` is `{
readonly bounds: Box3 }`: its axis-aligned bounds in local units. A draw call
carrying a non-finite number in a transform, position, size, or point draws
nothing for that call, and is still recorded.

The two draw calls that take options take these:

```ts
interface DrawMeshOptions {
  material?: MaterialLike;
  clip?: string;
  clipTime?: number;
}

interface HudTextOptions {
  size?: number;
  color?: Color;
  align?: "left" | "center" | "right";
}
```

| `DrawMeshOptions` | Default | Meaning |
| --- | --- | --- |
| `material` | The mesh's own materials | Overrides every material the file carries. |
| `clip` | — (rest pose) | The animation clip to pose from, one of `mesh.clips`. Naming a clip the mesh does not carry throws. |
| `clipTime` | `0` | The clip time to sample, in seconds, looping over the clip's duration. |

| `HudTextOptions` | Default | Meaning |
| --- | --- | --- |
| `size` | `24` | The em size in logical units. |
| `color` | `"#ffffff"` | The fill color. |
| `align` | `"left"` | Which horizontal anchor `position` names. |

`position` is the top-left of the text's em box under `"left"`, the top-center
under `"center"`, and the top-right under `"right"`. The face is the engine's
own monospace face and there is no font option, so the same call letters the
same in every build: `size` is the height of the glyph cell in logical units
and each glyph advances half of `size`, which makes a string's width
`size / 2` per character.

## Direct drawing

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

A picture the built-in components cannot state is drawn with a `DrawComponent`.
The engine calls `draw` in the component's place in the layer order, handing it
the scene context with this frame's camera, lights, and mode already in force,
so the component issues draw calls in world units and inherits the render modes
without implementing them.

```ts
import { DrawComponent, type DrawApi, type Vec3 } from "@test-cabinet/structured-3d";
import { PALETTE } from "./constants";

export class Trail extends DrawComponent {
  private readonly points: Vec3[] = [];

  override tick(): void {
    const at = this.worldTransform();
    this.points.push({ ...at.position });
    if (this.points.length > 48) this.points.shift();
  }

  draw(api: DrawApi): void {
    if (this.points.length < 2) return;
    const color = api.mode === "wireframe" ? PALETTE.hud : PALETTE.trail;
    api.scene.drawLine(this.points, color);
  }
}
```

Attach it like any other render component and give it a layer. Sharing the
scene's layer lets the depth buffer order it against the geometry around it; a
later layer would draw it over everything.

**A `DrawComponent` never sets the renderer state.** `setCamera`, `setLights`,
`setMode`, and `clearDepth` belong to the pipeline, and calling one from `draw`
throws, naming the rule. `api.mode` stays readable for a component that draws
differently under one mode, as the trail does for wireframe.

`DrawApi` also carries `frame()` (the frame counter, the accumulated simulated
time, and the most recent delta), `viewport()` (the current logical-to-device
fit), and `camera()` (this frame's `CameraState`), each as a snapshot the caller
owns.

## The ticks and the pipeline

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline, so the simulation is examinable
independently of any drawing surface.

## Errors

| Condition | Result |
| --- | --- |
| A `tick` or a `draw` throws under `run` | The error propagates to the host, and the loop schedules the next frame |
| A `tick` or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
| `setCamera`, `setLights`, `setMode`, or `clearDepth` called from a `draw` | `Error` naming the rule |
| `drawMesh` with a `clip` not in `mesh.clips` | `Error` naming the clip and listing `mesh.clips` |
| A producer called with a dimension that is not finite and positive | `RangeError` naming the value |
| `createMaterial` with `roughness`, `metallic`, or `opacity` outside `0`–`1` or not finite | `RangeError` naming the field and value |
