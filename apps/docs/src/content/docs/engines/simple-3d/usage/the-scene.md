---
title: The Scene
---

Everything a game shows in three dimensions goes into `api.scene` from
`render(state, api)`. The scene is the engine's one `THREE.Scene`, created
empty at construction and retained for the engine's life: what `render` adds on
one frame is still there on the next. A game therefore builds each object once,
finds it again on later frames, and writes its pose from the state, adding an
object when the state gains a thing and removing it when the state loses one.

```ts
import * as THREE from "three";
import type { Game } from "@test-cabinet/simple-3d";

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

    return [
      { crates: [{ id: 1, x: -2, y: 0.5, z: 0 }, { id: 2, x: 2, y: 0.5, z: 0 }] },
      null,
    ];
  },

  update(state, api, dt) {
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

The lights, the ground, and the background are placed once from `initialize`,
through `InitApi.scene`, and are still there when the first `render` runs. The
crates are the part of the picture that follows the state, so `render` keeps
one mesh per crate id and writes each mesh's position from the crate it stands
for. After `render` returns, the engine updates world matrices and renders the
scene through the camera, so the picture is what `render` left.

## Build once, update every frame

A three object is mutated in place, and building one costs a geometry and a
material upload. A game therefore constructs each object the first frame the
state names it and, on every frame after, writes onto the object it already
has: position, rotation, scale, `visible`, and a material's color. The scene is
retained, so each object is built once for the engine's life.

The pose comes from the state each frame rather than being advanced on the
object. `mesh.position.set(crate.x, crate.y, crate.z)` reads the state's
answer, and `render` receives no delta and returns no state, so integration
belongs in `update`. The
[view](/engines/simple-3d/apis/view/) page's plain `Vec3` and `Quat` move
between the state and three's classes through `set` and `toArray`, and a
rotation the state carries as a quaternion is written with
`mesh.quaternion.set(q.x, q.y, q.z, q.w)`.

## The render cache

The state carries the simulation alone. The engine hands every reader a
`DeepReadonly<S>` view, and a mesh is mutated in place, so
the objects a game creates for its picture live on the render side, in a cache
keyed by the ids the state carries. Two shapes serve.

A module-level `Map` from id to object is the first, and the example above
uses it. A module-level variable belongs to the module, so every engine built
from that module shares it, and a validator constructs one engine per test over
the same game module. Keying the cache by the scene it renders into, through a
`WeakMap<THREE.Scene, …>` as `cratesIn` does, gives each engine its own cache
that starts empty with its own scene, and lets it go when the engine does.

The scene itself is the second. A game names each object it places and finds it
again with `scene.getObjectByName`, which is per-engine by construction and
needs no module state.

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

A name is also what a validator reads a build's scene by, through
`engine.scene.getObjectByName`, so the objects a case's checks look for carry
the names the case fixes. A single object suits the name; a population keyed
by id suits the map, and naming each entry `crate-${id}` as well costs nothing.

## Adding and removing as the state changes

The state names the things that exist, so `render` reconciles the cache against
it: each id the state carries gets an object, created on first sight, and each
object whose id the state no longer carries is removed from the scene and
dropped from the cache. The alive-set walk in the example above is the whole of
that, and it runs every frame at the cost of one pass over the population.

The objects a game placed are its own, so it disposes the geometries and
materials it stops using. `scene.remove` takes an object out of the picture and
`geometry.dispose()` and `material.dispose()` release what the renderer holds
for it. A clone of a loaded model shares its geometries and materials with the
template, so removing a clone removes the object alone, and the template's
resources stay for the next clone.

An object the state hides rather than drops is a `visible` flag written from
the state, which keeps the object built and costs no upload when it returns.

```ts
mesh.visible = crate.phase !== "packed";
```

## Render only draws

`render` receives the state as a `DeepReadonly` view and returns nothing, so
the picture is a function of the state `update` returned and the compiler
refuses a render that assigns into it. A value the picture depends on, such as
an animation phase, a highlighted id, or a swing angle, is computed in `update`
and carried in the state, and `render` writes it onto the object.

`RenderApi` carries the scene, the camera, the screen layer, the frame counter,
the viewport, and the view. Input and audio are absent from it, so a frame's
response to the player is decided entirely by `update`.

## Placing in `initialize`

`InitApi.scene` is the same scene `render` receives. Lights, a ground plane, a
skybox, and any geometry that stands for the life of the game go in from
`initialize`, and they are in place when the first frame runs. A game that
loads a model and places exactly one copy of it adds the clone here as well and
poses it from `render` by name.

```ts
async initialize(api) {
  const yard = await api.assets.loadModel("models/yard.glb");
  const placed = cloneModel(yard);
  placed.name = "yard";
  api.scene.add(placed);
  return [initialState(), null];
}
```

## Models

A model loaded through [`assets.loadModel`](/engines/simple-3d/apis/assets/)
is a template: a `Model` whose `scene` is the decoded node tree, whose
`animations` are its clips, and whose `nodes` list every node name. A game
keeps the templates it loaded in a module-level map written from `initialize`,
and places a model by cloning the template with `cloneModel` and adding the
clone to the scene. One template yields as many placed copies as the state
names, each posed on its own.

```ts
import * as THREE from "three";
import { cloneModel, type Model } from "@test-cabinet/simple-3d";

const templates = new Map<string, Model>();

function template(name: string): Model {
  const model = templates.get(name);
  if (model === undefined) throw new Error(`model ${name} was not loaded`);
  return model;
}

// In initialize.
templates.set("crane", await api.assets.loadModel("models/crane.glb"));

// In render, for each crane the state carries.
let rig = cranes.get(crane.id);
if (rig === undefined) {
  rig = cloneModel(template("crane"));
  api.scene.add(rig);
  cranes.set(crane.id, rig);
}
rig.position.set(crane.x, 0, crane.z);
rig.rotation.y = crane.heading;
```

A clone keeps the node names the file carries, so a joint the exporter named is
driven directly: `rig.getObjectByName("boom")` finds the boom, and `render`
writes its rotation from the state's swing angle. `cloneModel` keeps a skinned
mesh bound to its own skeleton, so two clones of a rigged figure pose
independently.

An animation clip plays through a three `AnimationMixer` over the clone, and
the time it plays at is a field of the state. `update` advances the phase in
seconds and `render` writes it, so the pose a frame shows is the state's
answer, as every other pose is.

```ts
interface Figure {
  readonly rig: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
}

function placeFigure(scene: THREE.Scene, model: Model): Figure {
  const rig = cloneModel(model);
  const mixer = new THREE.AnimationMixer(rig);
  const walk = model.animations.find((clip) => clip.name === "walk");
  if (walk !== undefined) mixer.clipAction(walk).play();
  scene.add(rig);
  return { rig, mixer };
}

// In render.
figure.mixer.setTime(state.walker.walkTime);
```

## Lights

Lights belong to the scene the same way as any object: a game adds an
`AmbientLight`, a `HemisphereLight`, a `DirectionalLight`, a `PointLight`, or a
`SpotLight`, positions it, and leaves it in place across frames. The scene
starts with no light, so a scene of lit materials with none added renders
black. An ambient or hemisphere light for the fill and one directional light
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
matrix updates. A light that follows the state, a lamp on a moving crane for
one, is posed from `render` like any other object.

A `MeshBasicMaterial` ignores lights and shows its color flat, which suits
markers, guides, and anything the picture reads as unlit. Lit materials are
`MeshLambertMaterial`, `MeshPhongMaterial`, and `MeshStandardMaterial`; the
recording carries those four kinds, the line and points materials, and the five
lights above, so a scene built from them replays exactly.

## Shadows

Shadows are enabled at construction with `shadows: true`, and from there which
lights cast and which objects cast and receive is the game's. A
directional light's shadow camera is orthographic and starts small, so a
scene wider than a few units sets its extents to cover the ground the shadows
fall on.

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

A clone of a model carries the `castShadow` and `receiveShadow` flags of the
template's meshes, which a glTF file leaves off, so a game that wants a model
shadowed traverses the clone and sets them. Under the `headless` backend a
shadow produces nothing, as the rest of the 3D picture does, and a recording
carries no shadow settings.

## The background

`scene.background` paints inside the viewport, behind everything the scene
draws, and takes a `THREE.Color` or a texture loaded through
`assets.loadTexture`. [`EngineOptions.background`](/engines/simple-3d/apis/engine/)
is the color the whole canvas is cleared to, letterbox bars included, so the
two together give a sky inside the picture and a border around it. A scene
with no background set shows the canvas clear color through the viewport.

```ts
api.scene.background = new THREE.Color("#0b1020");
api.scene.fog = new THREE.Fog("#0b1020", 30, 90);
```

Fog is a scene property the same way and fades lit and unlit materials toward
its color with distance, which is what keeps a large field from ending at a
hard far plane.
