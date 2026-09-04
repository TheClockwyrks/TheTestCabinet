# Drawing

Everything a game draws goes inside `render(state, api)` and reaches the canvas
through `api.scene`, the engine-owned scene context. The scene arrives cleared,
the world is the game's own, and the camera set through the scene context
projects it into the logical design field, which the engine letterboxes onto the
element whatever size it happens to be.

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

The whole drawing vocabulary: three state setters, a depth clear, six draw
calls, and six producers. Every draw call is self-contained, naming its full
world transform or position explicitly, and no method reads anything back. There
is no transform stack, no `save`/`restore`, and no getters.

| Member | Intent |
| --- | --- |
| `setCamera` | Sets the frustum camera the scene is projected through. Retained: holds until set again. The argument is copied. |
| `setLights` | Replaces the light list wholesale. Retained. The array and its entries are copied. The renderer uses the first 64 entries. |
| `setMode` | Sets the render mode: `"standard"` is the lit default, beside `"wireframe"`, `"unlit"`, and `"normals"`. Retained. The mode governs mesh and geometry draws; billboards, lines, and HUD draws render the same under every mode. |
| `clearDepth` | Clears the depth buffer where it stands in the issue order, so draws issued after it sit over everything drawn before it however near the earlier geometry is. Not retained: every frame still opens with its own depth reset. |
| `drawMesh` | Draws a loaded glTF mesh under a world transform, with its file's own materials unless overridden. |
| `drawGeometry` | Draws a procedural geometry under a world transform with the given material. |
| `drawBillboard` | Draws a camera-facing, unlit, alpha-blended quad of `size` world units centered at `position`. |
| `drawLine` | Draws a connected world-space polyline, one device pixel wide. Fewer than two points draws nothing. |
| `drawHudText` | Draws text in logical design coordinates, composited above the 3D picture. |
| `drawHudRect` | Fills an axis-aligned rectangle in logical design coordinates, composited above the 3D picture. |
| `createBox` | A box geometry of `size` world units, centered at the local origin. |
| `createSphere` | A sphere of `radius`, centered at the local origin, tessellated at 32×16 segments. |
| `createCylinder` | A capped cylinder of `radius` and `height` on the local Y axis, centered, 32 radial segments. |
| `createCapsule` | A capsule of `radius` on the local Y axis, centered; `height` is the distance between the centers of its two hemispherical caps, so the extent along the axis is `height + 2 * radius`. 32 radial segments, each cap 8 rings. |
| `createPlane` | A `width`×`depth` plane on the local XZ plane, +Y normal, centered. |
| `createMaterial` | A material built in code from a `MaterialSpec`. |

## Set the camera and lights first

The three `set*` calls are the whole renderer state: the camera, the lights, and
the render mode. A fresh engine holds the default `CameraState`, an empty light
list, and `"standard"`. A state call takes effect for every draw issued after
it, within the frame and across frames.

With an empty light list the standard mode lights nothing: meshes render black
except emissive terms and unlit materials. Set the lights and the camera before
the first draw — an ambient plus a directional light is the standard opening
pair — and keep the camera in the game's state, so the value `render` applies is
the one the rest of the game reasons with.

```ts
const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#404050", intensity: 0.5 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 1,
    direction: { x: -1, y: -2, z: -1 },
  },
];

render(state, api) {
  const { scene } = api;
  scene.setCamera(state.camera);
  scene.setLights(LIGHTS);

  drawFloor(scene);
  for (const rock of state.rocks) scene.drawMesh(ROCK, rock.transform);
  scene.drawMesh(SHIP, state.ship.transform);
  drawScore(scene, state.score);
}
```

Re-applying both at the top of every `render` is the idiomatic shape: it costs
nothing, and the picture stays a function of the state alone.

A light is one of three shapes:

```ts
type LightState =
  | { type: "ambient"; color: Color; intensity: number }
  | { type: "directional"; color: Color; intensity: number; direction: Vec3 }
  | { type: "point"; color: Color; intensity: number; position: Vec3; range: number };
```

`Color` is a CSS color string, which is what `background` and every other color
the engine takes is too.

## Every frame draws the whole picture

The engine clears the canvas before each frame, so `render` starts from a blank
field and issues every draw that should be visible. That leaves a build free of
scene-graph bookkeeping and makes a single frame enough to describe what the game
looked like at that instant.

Issue order is not paint order. Opaque draws resolve by the depth buffer, so a
build issues them in whatever order its code reads best. The state setters and
`clearDepth` divide a frame's draws into runs, and translucent draws — a material
whose `opacity` is below `1`, every billboard, every line over a translucent
color — render after their own run's opaque draws, sorted farthest-first by the
distance from the run's camera to the draw's position. A frame that sets its
state once and clears no depth mid-frame is a single run, so the common case is
simply: translucent after every opaque draw. HUD draws composite last, above the
3D picture, in issue order across the whole frame.

`render` receives the state as a `DeepReadonly` view and returns nothing, so the
picture is a function of the state `update` returned and the compiler refuses a
render that assigns into it. A value the drawing depends on, such as an
animation phase or a highlighted entity, is computed in `update` and carried in
the state. `RenderApi` carries the scene context, `frame()`, and `viewport()`,
and nothing else: input and audio are absent, so a frame's response to the
player is decided entirely by `update`.

## Geometry and materials are cheap

A produced value is immutable and creation is deterministic, so creating per
frame inside `render` is idiomatic — two calls with the same arguments share one
entry in a recording — and keeping the value in module scope is equally fine.
`initialize` receives no scene context, so there is no third place to create
them.

```ts
function drawFloor(scene: SceneContext): void {
  const floor = scene.createPlane(40, 40);
  const grass = scene.createMaterial({ baseColor: "#2f5d34", roughness: 1 });
  scene.drawGeometry(floor, grass, at({ x: 0, y: 0, z: 0 }));
}
```

A `Geometry` is `{ readonly bounds: Box3 }` — its axis-aligned bounds in local
units, which games use for their own collision arithmetic.

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

interface Material {
  readonly spec: Readonly<MaterialSpec>;
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

`Material.spec` is the spec with defaults filled in, as a frozen copy;
`createMaterial` copies its argument. A `Color` string stands in for a whole
material where the defaults suit — a standard lit material with that base color
— and a `MaterialHandle` loaded from a produced material document slots into the
same argument. See `assets.md`.

## Meshes and animation

```ts
interface DrawMeshOptions {
  material?: MaterialLike;
  clip?: string;
  clipTime?: number;
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `material` | The mesh's own materials | Overrides every material the file carries. |
| `clip` | — (rest pose) | The animation clip to pose from, one of `mesh.clips`. |
| `clipTime` | `0` | The clip time to sample, in seconds, looping over the clip's duration. |

`drawMesh` with a `clip` poses the mesh at `clipTime` seconds, sampled looping:
the time is taken modulo the clip's duration, so an accumulated game-time value
plays the loop. Omitting `clip` draws the file's rest pose. The pose is a pure
function of the arguments, which is what keeps a recorded frame drawable from
itself alone.

```ts
scene.drawMesh(state.walker, state.walkerTransform, {
  clip: "walk",
  clipTime: state.elapsed,
});
```

## The HUD

Score, timers, and menus draw through `drawHudText` and `drawHudRect`, in
logical design coordinates with `(0, 0)` at the top-left of the field. HUD
drawing composites above the 3D picture, so it needs no camera arithmetic and
sits at the same place on screen whatever the camera does.

```ts
interface HudTextOptions {
  size?: number;
  color?: Color;
  align?: "left" | "center" | "right";
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `size` | `24` | The em size in logical units. |
| `color` | `"#ffffff"` | The fill color. |
| `align` | `"left"` | Which horizontal anchor `position` names. |

`position` is the top-left of the text's em box under `"left"`, the top-center
under `"center"`, and the top-right under `"right"`. There is no font option: the
face is the engine's own monospace face, Unscii 16, an 8×16 bitmap face carried
in the package as glyph data and covering printable ASCII, so the same call
letters the same in every build and in the reviewer's player. A character outside
the coverage letters as the replacement box. `size` is the height of the 16-pixel
glyph cell in logical units, and each glyph advances half of `size`.

```ts
function drawScore(scene: SceneContext, score: number): void {
  scene.drawHudRect({ x: 260, y: 16 }, { x: 120, y: 32 }, "#00000080");
  scene.drawHudText(`SCORE ${score}`, { x: 320, y: 20 }, {
    size: 24,
    color: "#ffffff",
    align: "center",
  });
}
```

A label that should sit over a world object projects that object's position into
the field with `projectPoint` and hands the result to `drawHudText`; a point
behind the camera projects to `null`, which is the cue to skip the label. See
`viewport.md`. Debug text belongs on the overlay instead, which the engine draws
over the finished picture and a reviewer toggles on demand. See
`diagnostics.md`.

## Non-finite numbers

A draw call carrying a non-finite number in a transform, position, size, or
point draws nothing for that call. The call is still recorded, so a recording
shows what the frame asked for.

## Outside `render`

The scene context is live only while `render` runs. A call from `update`, from a
stored closure, or after `destroy` throws, naming the rule.

## Errors

| Condition | Result |
| --- | --- |
| A scene context method called outside `render` | `Error` naming the rule |
| `drawMesh` with a `clip` not in `mesh.clips` | `Error` naming the clip and listing `mesh.clips` |
| `setMode` with a value outside `RenderMode` | `Error` naming every valid mode |
| `createBox`, `createSphere`, `createCylinder`, `createCapsule`, or `createPlane` with a dimension that is not finite and positive | `RangeError` naming the value |
| `createMaterial` with `roughness`, `metallic`, or `opacity` outside `0`–`1` or not finite | `RangeError` naming the field and value |
