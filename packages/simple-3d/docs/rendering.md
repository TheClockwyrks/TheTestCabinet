# Rendering

Every frame the engine draws two things onto the canvas handed to
`createEngine`.

| Surface | Object | Populated by | Drawn by |
| --- | --- | --- | --- |
| The scene | A `THREE.Scene`, rendered through a `THREE.WebGLRenderer` over the canvas | The game, from `render` | The engine, through the camera |
| The screen layer | A 2D canvas the engine owns, sized to the same backing store | The game, on its `CanvasRenderingContext2D` | The engine, composited over the scene |

The scene is the 3D picture. The screen layer carries HUD text, menus, readouts,
and the diagnostics overlay, drawn through a 2D context that carries the logical
viewport transform. At the end of every frame the screen layer is uploaded as a
texture and drawn over the 3D picture as a full-canvas quad with alpha blending,
so wherever the screen layer is transparent the scene shows through.

`render` receives both, plus the camera:

```ts
interface RenderApi {
  readonly scene: THREE.Scene;
  readonly camera: SceneCamera;
  readonly screen: CanvasRenderingContext2D;
  frame(): FrameInfo;
  viewport(): Viewport;
  view(): View;
}
```

Input and audio are absent from it, so a frame's response to the player is
decided entirely by `update`. `render` receives the state as a `DeepReadonly`
view and returns nothing, so the picture is a function of the state `update`
returned: a value the picture depends on — an animation phase, a highlighted id,
a swing angle — is computed in `update` and carried in the state.

## The scene

`api.scene` is the engine's one `THREE.Scene`, created empty at construction
with no lights and no background, and kept for the engine's life. It is
**retained**: what `render` adds on one frame is still there on the next.
`initialize` receives the same object as `InitApi.scene`, and `engine.scene`
hands it out from construction onward, so lights and standing geometry go in
once and a caller may read the scene back after any number of frames.

A game therefore builds each object the first frame the state names it, finds it
again on later frames, and writes its pose from the state.

```ts
import * as THREE from "three";
import type { Game } from "@clockwyrks/simple-3d";

interface Crate {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface State {
  readonly crates: readonly Crate[];
}

type CrateMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

const crateMeshes = new WeakMap<THREE.Scene, Map<number, CrateMesh>>();

function cratesIn(scene: THREE.Scene): Map<number, CrateMesh> {
  let meshes = crateMeshes.get(scene);
  if (meshes === undefined) {
    meshes = new Map();
    crateMeshes.set(scene, meshes);
  }
  return meshes;
}

const game: Game<State, null> = {
  initialize(api) {
    api.scene.background = new THREE.Color("#1b1b2a");
    api.scene.add(new THREE.AmbientLight("#ffffff", 0.5));

    const sun = new THREE.DirectionalLight("#ffffff", 1);
    sun.position.set(6, 12, 8);
    api.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: "#3b4a3a" }),
    );
    ground.rotation.x = -Math.PI / 2;
    api.scene.add(ground);

    return [{ crates: [{ id: 1, x: -2, y: 0.5, z: 0 }] }, null];
  },

  update(state, api) {
    const t = api.frame().timeMs / 1000;
    return {
      crates: state.crates.map((crate) => ({
        ...crate,
        y: 0.5 + 0.25 * Math.sin(t + crate.id),
      })),
    };
  },

  render(state, api) {
    const meshes = cratesIn(api.scene);
    const alive = new Set<number>();

    for (const crate of state.crates) {
      let mesh = meshes.get(crate.id);
      if (mesh === undefined) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color: "#c8a165" }),
        );
        mesh.name = `crate-${crate.id}`;
        meshes.set(crate.id, mesh);
        api.scene.add(mesh);
      }
      mesh.position.set(crate.x, crate.y, crate.z);
      alive.add(crate.id);
    }

    for (const [id, mesh] of meshes) {
      if (alive.has(id)) continue;
      api.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      meshes.delete(id);
    }

    api.camera.position.set(0, 6, 12);
    api.camera.lookAt(0, 0, 0);
  },
};
```

## The render cache

The state carries the simulation alone. The engine hands every reader a
`DeepReadonly<S>` view and a three object is mutated in place, so the objects a
game creates for its picture live on the render side, keyed by the ids the state
carries. Two shapes serve.

- A `Map` from id to object, as above. A bare module-level `Map` is shared by
  every engine built from that module; keying it by the scene it renders into,
  through a `WeakMap<THREE.Scene, …>`, gives each engine its own cache that
  starts empty with its own scene and is released with it.
- The scene itself. A game names each object it places and finds it again with
  `scene.getObjectByName`, which is per-engine by construction and needs no
  module state.

```ts
function roverIn(scene: THREE.Scene): THREE.Object3D {
  const found = scene.getObjectByName("rover");
  if (found !== undefined) return found;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.5, 1.6),
    new THREE.MeshStandardMaterial({ color: "#f5d76e" }),
  );
  mesh.name = "rover";
  scene.add(mesh);
  return mesh;
}
```

A name is also what a case's checks read a build's scene by, through
`engine.scene.getObjectByName`, so the objects a case names carry the names the
case fixes. A single object suits the name; a population keyed by id suits the
map, and naming each entry `crate-${id}` as well costs nothing.

Objects that look alike share one geometry and one material, built once at
module level, so a hundred crates upload one box and one shader.

## Adding and removing as the state changes

The state names the things that exist, so `render` reconciles the cache against
it: each id the state carries gets an object, created on first sight, and each
object whose id is absent is removed from the scene and dropped from the cache.
The alive-set walk above is the whole of that, at the cost of one pass over the
population per frame.

The objects a game placed are its own, so it disposes what it stops using:
`scene.remove` takes an object out of the picture, and `geometry.dispose()` and
`material.dispose()` release what the renderer holds for it. A geometry or
material shared across objects lives for the game's life. A clone of a loaded
model shares its geometries and materials with the template, so removing a clone
removes the object alone.

An object the state hides rather than drops is a `visible` flag written from the
state, which keeps the object built and costs no upload when it returns:

```ts
mesh.visible = crate.phase !== "packed";
```

## Placing in `initialize`

`InitApi.scene` is the same scene `render` receives. Lights, a ground plane, a
skybox, and any geometry that stands for the life of the game go in from
`initialize` and are in place when the first `render` runs. A game that loads a
model and places exactly one copy adds the clone here as well and poses it from
`render` by name. See `assets.md` for `loadModel` and `cloneModel`.

```ts
async initialize(api) {
  const yard = await api.assets.loadModel("models/yard.glb");
  const placed = cloneModel(yard);
  placed.name = "yard";
  api.scene.add(placed);
  return [initialState(), null];
}
```

## Lights

The scene starts with no light, so lit materials render black until one is
added. A game adds an `AmbientLight`, a `HemisphereLight`, a `DirectionalLight`,
a `PointLight`, or a `SpotLight`, positions it, and leaves it in place across
frames. An ambient or hemisphere light for the fill and one directional light
for the key is a rig that reads well and records well.

```ts
api.scene.add(new THREE.HemisphereLight("#cfe4ff", "#3a3324", 0.6));

const sun = new THREE.DirectionalLight("#fff4e0", 1.4);
sun.position.set(10, 16, 6);
sun.target.position.set(0, 0, 0);
api.scene.add(sun);
api.scene.add(sun.target);
```

A directional or spot light shines from its position toward its `target`, and
the target is an object of its own that is added to the scene so its world
matrix updates. A light that follows the state is posed from `render` like any
other object.

A `MeshBasicMaterial` ignores lights and shows its color flat, which suits
markers and guides. `MeshLambertMaterial`, `MeshPhongMaterial`, and
`MeshStandardMaterial` are lit, and a recording shows each as the renderer drew
it.

## Shadows

`EngineOptions.shadows` is `false` by default. `true` turns the renderer's
shadow maps on with PCF soft filtering; which lights cast and which objects cast
and receive is the game's, through `castShadow` and `receiveShadow` as three
reads them. A directional light's shadow camera is orthographic and starts
small, so a scene wider than a few units sets its extents to cover the ground
the shadows fall on.

```ts
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;

ground.receiveShadow = true;
mesh.castShadow = true;
mesh.receiveShadow = true;
```

A clone of a model carries the flags of the template's meshes, which a glTF file
leaves off, so a game that wants a model shadowed traverses the clone and sets
them. Shadow maps cost a render of the scene per casting light.

## The background

Two colors, at two different scopes.

- `EngineOptions.background` is the CSS color the **whole canvas** is cleared to
  before the scene is rendered, letterbox bars included. The clear happens
  before the scissor is applied, so the bars carry it. Absent, the canvas clears
  to transparency and the page shows through.
- `scene.background` paints **inside the viewport** alone, behind everything the
  scene draws. It takes a `THREE.Color` or a texture loaded through
  `assets.loadTexture`.

The two together give a sky inside the picture and a border around it. Fog is a
scene property the same way, and fades lit and unlit materials toward its color
with distance, which keeps a large field from ending at a hard far plane.

```ts
api.scene.background = new THREE.Color("#0b1020");
api.scene.fog = new THREE.Fog("#0b1020", 30, 90);
```

## The screen layer

`api.screen` is the screen layer's 2D context. It is cleared at the top of every
frame and given the viewport transform — replaced, not composed — so drawing is
in logical coordinates: `(0, 0)` is the top-left of the design field and
`(width, height)` its bottom-right, whatever size the canvas element happens to
be.

```ts
render(state, api) {
  const { screen } = api;
  const vp = api.viewport();

  screen.fillStyle = "rgba(0, 0, 0, 0.5)";
  screen.fillRect(0, 0, vp.width, 48);

  screen.font = "16px monospace";
  screen.fillStyle = "#ffffff";
  screen.textAlign = "left";
  screen.textBaseline = "middle";
  screen.fillText(`SCORE ${state.score}`, 16, 24);
}
```

The layer is the opposite of the scene: the scene is retained and updated in
place, while the layer is cleared and drawn afresh every frame. Every frame is
therefore a complete picture of the HUD, which leaves a build free of
dirty-rectangle bookkeeping. Draw back to front — the panels, then the text over
them, then anything that sits on top of both.

Because the transform is replaced at the top of each frame, a `translate`,
`rotate`, or `scale` left behind at the end of `render` is discarded rather than
compounding. Balance `save` and `restore` around a transformed subtree anyway,
so the rest of that same frame draws where it meant to.

```ts
screen.save();
screen.translate(state.compass.x, state.compass.y);
screen.rotate(state.yaw);
screen.fillStyle = "#f5d76e";
screen.fillRect(-2, -18, 4, 18);
screen.restore();
```

Fill and stroke styles, the font, the alpha, and the line width carry across
draw calls within a frame, so set each one where the drawing that depends on it
happens. Font sizes are logical units like every other measurement, so text
scales with the rest of the picture as the window changes size.

The scene keeps rendering behind whatever the layer draws, so a title screen or
a pause menu is a translucent fill over the design field followed by its
entries; a fully opaque fill hides the scene for the frame it is drawn on and
costs the same frame as one that lets the world show through.

Debug text belongs on the overlay instead, which the engine draws on the screen
layer over the finished picture in device pixels. See `diagnostics.md`.

## The renderer and the fit

The engine obtains a `webgl2` context from the stage canvas at construction and
builds a `THREE.WebGLRenderer` over it with antialiasing on, alpha on, and sRGB
output. A canvas that yields no `webgl2` context is refused by `createEngine`.

The letterboxed rectangle is `offsetX, offsetY, width * scale, height * scale`
in device pixels, from the viewport the engine recomputes at the top of every
frame:

```ts
interface Viewport {
  readonly width: number;
  readonly height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}
```

`scale` is device pixels per logical unit with the device pixel ratio folded in,
and the offsets are the left and top bars in device pixels, so a logical point
maps to device space as `offsetX + x * scale`. The renderer's viewport and
scissor are set to that rectangle with the scissor test on, and the screen
layer's transform maps onto the same rectangle, so the 3D picture and the HUD
line up pixel for pixel. A perspective camera's `aspect` is held at
`width / height`, so the picture keeps the design aspect whatever the element's
shape and the bars absorb the difference.

`engine.viewport()` and the `viewport()` on each of `InitApi`, `UpdateApi`, and
`RenderApi` return the current fit as a snapshot the caller owns.

## The screen canvas

`EngineOptions.screen` is the canvas the screen layer draws on. Absent, the
engine creates one with `document.createElement("canvas")` from the stage
canvas's owning document and keeps it off the page, syncing its backing store to
the stage canvas's every frame. A build in the browser names it in no code.

Supplying it is what lets a check read the HUD's pixels back, through
`getImageData` on the canvas it handed over.

## Disposal

`engine.destroy()` halts the loop, drops every listener, stops every loop the
audio bus is running, and disposes the renderer. It is idempotent. The scene and
the objects the game placed in it stay as they stand, so a caller that reads the
scene after destroying the engine still finds what the last frame left.

## Errors

| Condition | Result |
| --- | --- |
| The canvas yields no `webgl2` context | `Error` naming the canvas |
| No `screen` canvas supplied and the stage canvas has no owning document | `Error` naming `screen` |
| `projection` outside `"perspective"` / `"orthographic"` | `Error` naming both values |

Each is raised by `createEngine`, so a build that would run and draw nothing is
refused where the mistake is.
