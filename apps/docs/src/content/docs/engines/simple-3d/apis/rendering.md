---
title: Rendering
---

The engine owns the renderer, the scene object, the camera, and the screen
layer. A game populates the scene, poses the camera, and draws its readouts on
the screen layer from `render`, and the engine draws the scene through the
camera and composites the screen layer over it once per frame.

## The two surfaces

Every frame the engine draws two things onto the canvas handed to
`createEngine`.

| Surface          | Object                                                                    | Populated by                                | Drawn by                              |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| The scene        | A `THREE.Scene`, rendered through a `THREE.WebGLRenderer` over the canvas | The game, from `render`                     | The engine, through the camera        |
| The screen layer | A 2D canvas the engine owns, sized to the same backing store              | The game, on its `CanvasRenderingContext2D` | The engine, composited over the scene |

The scene is the 3D picture. The screen layer carries HUD text, menus,
readouts, and the diagnostics overlay, drawn through a 2D context that carries
the logical viewport transform exactly as a 2D engine's context does. At the
end of every frame the screen layer is uploaded as a texture and drawn over the
3D picture as a full-canvas quad with alpha blending, so wherever the screen
layer is transparent the scene shows through.

## The scene

```ts
interface Engine<S, D = unknown> {
  readonly scene: THREE.Scene;
  readonly camera: SceneCamera;
}
```

`engine.scene` is one `THREE.Scene`, created empty at construction with no
lights and no background, and kept for the engine's life. It is retained: what
`render` adds on one frame is still there on the next. `render` receives it as
`RenderApi.scene` and `initialize` as `InitApi.scene`, so a game that loads
models may place them during initialization, and both `scene` and `camera` are
available on the engine from construction, so a validator reads the scene a
build populated after any number of frames.

A game builds its objects once and updates them from the state each frame,
adding an object when the state gains a thing and removing it when the state
loses one. The state carries the simulation alone: the engine hands every
reader a `DeepReadonly<S>` view, and a three object is mutated in place, so no
three object lives in the state. A game keeps the objects it created in a
render-side cache, a module-level `Map` keyed by the ids the state carries, or
in the scene itself under `object.name`, found with `scene.getObjectByName`.
Objects that look alike share one geometry and one material, built once at
module level, so a hundred crates upload one box and one shader.

```ts
import * as THREE from "three";
import type { DeepReadonly, RenderApi, Vec3 } from "@clockwyrks/simple-3d";

interface State {
  crates: { id: number; x: number; y: number; z: number }[];
  eye: Vec3;
  focus: Vec3;
  zoomed: boolean;
  score: number;
}

const CRATE_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const CRATE_MATERIAL = new THREE.MeshStandardMaterial({ color: "#c8a165" });
const crates = new Map<number, THREE.Mesh>();

function render(state: DeepReadonly<State>, api: RenderApi): void {
  const alive = new Set<number>();
  for (const crate of state.crates) {
    let mesh = crates.get(crate.id);
    if (mesh === undefined) {
      mesh = new THREE.Mesh(CRATE_GEOMETRY, CRATE_MATERIAL);
      crates.set(crate.id, mesh);
      api.scene.add(mesh);
    }
    mesh.position.set(crate.x, crate.y, crate.z);
    alive.add(crate.id);
  }
  for (const [id, mesh] of crates) {
    if (!alive.has(id)) {
      api.scene.remove(mesh);
      crates.delete(id);
    }
  }
}
```

A model loaded through [`assets.loadModel`](/engines/simple-3d/apis/assets/)
is a template. A game places it by cloning it with `cloneModel(model)`, a deep
clone that keeps a skinned mesh bound to its own skeleton, and adding the clone
to the scene. The objects a game placed are its own, so it disposes the
geometries and materials it stops using; a geometry or material shared across
objects lives for the game's life, and one an object holds alone is disposed
when that object is removed.

Lights belong to the scene the same way. A game adds an `AmbientLight`, a
`DirectionalLight`, or any other three light as an object, positions it, and
leaves it in place across frames.

## The camera

```ts
type SceneCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
```

`engine.camera` is the camera the engine renders through, engine-owned and
game-posed, and `render` receives it as `RenderApi.camera`.
[`EngineOptions.projection`](/engines/simple-3d/apis/engine/) selects its
class at construction, `"perspective"` by default, and the class holds for the
engine's life. It starts at the [camera
defaults](/engines/simple-3d/apis/view/): a perspective camera at `fov 60`,
`near 0.1`, `far 1000`, and an orthographic one spanning `-width/2..width/2`
by `-height/2..height/2`, both at position `(0, 0, 10)` with the identity
rotation, looking along `-Z` with `+Y` up.

`render` writes the camera's position, its orientation through `lookAt`,
`quaternion`, or `rotation`, its `fov`, `near`, and `far`, or an orthographic
camera's extents. The engine holds a perspective camera's `aspect` at
`width / height` and updates the projection matrix before rendering, so a write
from `render` takes effect on the same frame's picture.

```ts
function render(state: DeepReadonly<State>, api: RenderApi): void {
  api.camera.position.set(state.eye.x, state.eye.y, state.eye.z);
  api.camera.lookAt(state.focus.x, state.focus.y, state.focus.z);
  if (api.camera instanceof THREE.PerspectiveCamera) {
    api.camera.fov = state.zoomed ? 35 : 60;
  }
}
```

## The screen layer

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

`screen` is the screen layer's 2D context. It is cleared at the top of every
frame and given the [viewport](/engines/simple-3d/apis/viewport/) transform,
replaced rather than composed, so drawing is in logical coordinates and
`0..width` by `0..height` lands inside the letterboxed picture. A game draws
its HUD there in the design size it declared, and the fit carries it onto the
canvas with the letterbox bars folded in.

```ts
function render(state: DeepReadonly<State>, api: RenderApi): void {
  api.screen.fillStyle = "#ffffff";
  api.screen.font = "16px sans-serif";
  api.screen.fillText(`score ${state.score}`, 16, 24);
}
```

The canvas behind it is [`EngineOptions.screen`](/engines/simple-3d/apis/engine/).
Absent, the engine creates one with `document.createElement("canvas")` from the
stage canvas's owning document, and the engine syncs its backing store to the
stage canvas's size and ratio every frame. A validator reads the screen
layer's pixels off this canvas through `getImageData`. A validator that wants
the drawing operations rather than the pixels substitutes its own object for the
context, and the engine passes through whatever the screen canvas returned.

## The renderer

The engine obtains a `webgl2` context from the stage canvas at construction and
builds a `THREE.WebGLRenderer` over it with antialiasing on, alpha on, and sRGB
output. A canvas that yields no `webgl2` context is refused by `createEngine`.

## Shadows

[`EngineOptions.shadows`](/engines/simple-3d/apis/engine/) is `false` by
default. `true` enables the renderer's shadow maps with PCF soft filtering.
Which lights cast and which objects cast and receive is the game's, through
`castShadow` on a light and a mesh and `receiveShadow` on a mesh, as three reads
them.

## Background

[`EngineOptions.background`](/engines/simple-3d/apis/engine/) is the color the
whole canvas is cleared to before the scene is rendered, letterbox bars
included; absent, the canvas is cleared to transparency. The clear happens
before the scissor is applied, so the bars carry the background color. The game
may also set `scene.background`, which paints inside the viewport alone.

## The viewport and the scissor

The letterboxed rectangle is `offsetX, offsetY, width * scale, height * scale`
in device pixels, from the [viewport](/engines/simple-3d/apis/viewport/) the
engine recomputes at the top of every frame. The renderer's viewport and
scissor are set to that rectangle with the scissor test on, so the
scene is drawn into the same region the screen layer's transform maps onto. A
perspective camera's `aspect` is held at `width / height`, so the picture keeps
the design aspect whatever the canvas's own is.

## One frame, in order

1. The clock is called once. A declined tick ends the frame.
2. The frame counter, `timeMs`, and `lastDeltaMs` advance.
3. Both canvases are synced to the surface's size and ratio; the viewport is
   recomputed.
4. The screen layer is cleared and given the viewport transform.
5. `update` runs with the delta in seconds; the state is replaced.
6. `render` runs: the game updates the scene, poses the camera, and draws on
   the screen layer.
7. The engine updates world matrices, reads the camera into the `View`, clears
   the canvas to `background`, applies the letterboxed viewport and scissor,
   and renders the scene through the camera.
8. The [recorder](/engines/simple-3d/apis/recording/) captures the frame.
9. The [diagnostics](/engines/simple-3d/apis/diagnostics/) overlay draws on the
   screen layer in device space.
10. The screen layer is composited over the picture.
11. The input frame closes.

Step 7 is where the camera the game posed in step 6 becomes the camera `View`
answers from, so the next frame's `update` picks against the camera the player
is looking through. The recorder captures the frame after the scene is rendered
and the screen layer drawn, and before the diagnostics overlay draws on the
screen layer. A recording therefore holds the picture the game submitted and
nothing of the overlay.

## What `render` does

`render` populates the scene, poses the camera, and draws on the screen layer,
from the state `update` returned as a read-only view. Nothing it is handed reads
input or plays a cue, and nothing `UpdateApi` carries draws. A frame's audible
and observable behavior is therefore decided by `update`, and the picture by
`render`.

`RenderApi.view()` answers from the camera as it stood at the previous frame's
render, because the engine takes its reading after `render` returns. A game that
projects a world point onto the screen layer from `render` therefore reads the
projection through the previous frame's pose, which coincides with this frame's
whenever the camera is still.

## Disposal

`engine.destroy()` halts the loop, drops every listener, stops every loop the
audio bus is running, and disposes the renderer. The scene and the objects the
game placed in it stay as they stand, so a caller that reads the scene after
destroying the engine still finds what the last frame left.

## Errors

| Condition                                                               | Result                     |
| ----------------------------------------------------------------------- | -------------------------- |
| The canvas yields no `webgl2` context                                   | `Error` naming the canvas  |
| No `screen` canvas supplied and the stage canvas has no owning document | `Error` naming `screen`    |
| `projection` outside `"perspective"` / `"orthographic"`                 | `Error` naming both values |

Each is raised by `createEngine`, so a build that would run and draw nothing is
refused where the mistake is.

## Exports

`SceneCamera` and `RenderApi` are exported as types, and `cloneModel` as a
function, from `@clockwyrks/simple-3d`. `three` is a peer dependency the build
declares itself, and the engine re-exports nothing from it, so a game imports
`three` directly and the engine, the build, and `@clockwyrks/voxel-runtime/three`
share one instance.
