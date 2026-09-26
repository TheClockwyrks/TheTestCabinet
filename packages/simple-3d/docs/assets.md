# Assets

A game loads what it needs during `initialize`, from `InitApi.assets`, and keeps
each result where it is read from: decoded images and audio buffers in its
state, textures and models in its render-side cache beside the retained scene.
Every path resolves under one root, and every load announces its outcome as an
engine event.

```ts
api.assets.loadImage(path: string): Promise<ImageBitmap>;
api.assets.loadTexture(path: string): Promise<THREE.Texture>;
api.assets.loadModel(path: string): Promise<Model>;
api.assets.loadAudio(path: string): Promise<AudioBuffer>;
api.assets.load(path: string): Promise<Blob>;
api.assets.resolve(path: string): string;
```

| Member        | Behavior                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadImage`   | Resolves the path, fetches it, and decodes the body to an `ImageBitmap` ready to draw on the screen layer.                                                        |
| `loadTexture` | Resolves the path, fetches it, decodes the body, and wraps the decoded image as a `THREE.Texture` in the sRGB color space, ready to assign as a material's `map`. |
| `loadModel`   | Resolves the path, fetches it, and decodes the body as a glTF 2.0 model, `.glb` or `.gltf`, to a `Model`.                                                         |
| `loadAudio`   | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play.                                                                            |
| `load`        | Resolves the path, fetches it, and resolves to the response body as a `Blob`.                                                                                     |
| `resolve`     | Returns the URL `path` loads from. Pure: it neither fetches nor emits.                                                                                            |

Each of the five loaders emits exactly one event per call. `resolve` is their
shared first step, so a path any one of them refuses is refused identically by
all of them.

## The asset root

The root is `EngineOptions.assetRoot`, defaulting to `assets/` and relative to
the page the build is served from. A path is written relative to that root, and
`resolve` is the concatenation of the two.

```ts
api.assets.resolve("models/ship.glb"); // "assets/models/ship.glb"
```

## Where each result lives

A game awaits its loads inside `initialize`, so every value it loads is present
by the time a frame can observe it. What differs is where the value is kept.

- An `ImageBitmap` and an `AudioBuffer` are plain values: the state carries them
  and `update` and `render` read them as fields.
- A `THREE.Texture` and a `Model` are three objects, which the state never
  carries. They go in a module-level cache, or straight into the scene during
  initialization.

```ts
interface State {
  readonly badge: ImageBitmap;
  readonly score: number;
}

async initialize(api) {
  const badge = await api.assets.loadImage("ui/badge.png");
  return [{ badge, score: 0 }, null];
}

render(state, api) {
  api.screen.drawImage(state.badge, 16, 16);
}
```

Loading several assets at once is an ordinary `Promise.all`:

```ts
async initialize(api) {
  const [crate, ship] = await Promise.all([
    api.assets.loadTexture("textures/crate.png"),
    api.assets.loadModel("models/ship.glb"),
  ]);
  materials.set("crate", new THREE.MeshStandardMaterial({ map: crate }));
  templates.set("ship", ship);
  return [openingState(), null];
}
```

## Textures

`loadTexture` hands back a `THREE.Texture` already in the sRGB color space, so
assigning it as a material's `map` shows the colors the image file carries. A
texture is a three object and belongs in the render-side cache; the material
that holds it is built once and shared by every mesh that wears it.

```ts
import * as THREE from "three";

const materials = new Map<string, THREE.MeshStandardMaterial>();

// In initialize.
const map = await api.assets.loadTexture("textures/crate.png");
map.wrapS = THREE.RepeatWrapping;
map.wrapT = THREE.RepeatWrapping;
materials.set("crate", new THREE.MeshStandardMaterial({ map }));
```

A texture is also what `scene.background` takes for a backdrop. See
`rendering.md`.

## Models

```ts
interface Model {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
  readonly nodes: readonly string[];
}

function cloneModel(model: Model): THREE.Group;
```

| Member       | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| `scene`      | The decoded node tree — a template, never placed directly.                        |
| `animations` | Every animation clip the file carries, playable through a three `AnimationMixer`. |
| `nodes`      | Every node name in the tree, in traversal order.                                  |

`loadModel` decodes glTF 2.0: the node hierarchy, meshes with their attributes,
materials, skins, and animations. `nodes` is carried beside the tree so a game
that rigs a hook to a crane arm can tell at load time whether the arm it expects
is in the file at all.

**A model is a template.** A game places it by cloning it with `cloneModel` and
adding the clone to the scene; one decode yields as many placed copies as the
state names, each posed independently. The template itself is never added, which
is what keeps a second placement from silently re-parenting the first.
`cloneModel` is a deep clone that rebinds a skinned mesh to its own skeleton, so
two clones of a rigged figure pose independently rather than walking in
lockstep. Node names survive the clone, so `getObjectByName` finds on a clone
the joint the exporter named in the file.

```ts
import * as THREE from "three";
import { cloneModel } from "@clockwyrks/simple-3d";
import type { Model } from "@clockwyrks/simple-3d";

const templates = new Map<string, Model>();
const cranes = new Map<number, THREE.Group>();

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

const boom = rig.getObjectByName("boom");
if (boom !== undefined) boom.rotation.z = crane.swing;
```

A clone shares its geometries and materials with the template, so removing a
clone removes the object alone and the template's resources stay for the next
one. A glTF file leaves `castShadow` and `receiveShadow` off, so a game that
wants a model shadowed traverses the clone and sets them.

### Animations

A clip plays through a three `AnimationMixer` over the clone, and the time it
plays at is a field of the state: `update` advances the phase in seconds and
`render` writes it, so the pose a frame shows is the state's answer, as every
other pose is.

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

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme, so every request a build makes lands under the root.

| Path                             | Result                                        |
| -------------------------------- | --------------------------------------------- |
| `"models/ship.glb"`              | `"assets/models/ship.glb"`                    |
| `"audio/theme.ogg"`              | `"assets/audio/theme.ogg"`                    |
| `""`                             | Throws: the path is empty.                    |
| `"/models/ship.glb"`             | Throws: a leading `/` leaves the root.        |
| `"../secrets.txt"`               | Throws: a `..` segment leaves the root.       |
| `"https://example.com/ship.glb"` | Throws: an absolute URL is not an asset path. |

## Events

Loading reports itself through the engine's event broadcaster, subscribed with
`api.events.on(name, handler)`.

```ts
"asset:loaded": { path: string; url: string };
"asset:failed": { path: string; url: string; reason: string };
```

| Field    | Meaning                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| `path`   | The path the game passed to the loader.                                                    |
| `url`    | The URL it resolved to, or `""` for a refused path.                                        |
| `reason` | Why the load failed: the refusal, the HTTP status, the network error, or the decode error. |

Subscribing to `asset:failed` on `engine.events` before `engine.initialize` is
what lets a caller observe the game's own loading, since the engine exists
before any game code has run.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`asset ${event.path} failed: ${event.reason}`);
});

const state = await engine.initialize();
```

`on` returns the function that removes the handler. Nothing accumulates a record
of the assets a run loaded; a subscriber keeps exactly what it needs.

## Load outcomes

Every loader announces the attempt in every case, and rejects whenever the value
did not arrive. The rejection carries the original cause unchanged.

| Condition                        | Event                                  | Promise                           |
| -------------------------------- | -------------------------------------- | --------------------------------- |
| The value arrives                | `asset:loaded` with the resolved `url` | Resolves to the value.            |
| The path is refused              | `asset:failed` with `url: ""`          | Rejects with the `resolve` error. |
| The response status is not `2xx` | `asset:failed` with the resolved `url` | Rejects, naming the status.       |
| The fetch fails                  | `asset:failed` with the resolved `url` | Rejects with the fetch error.     |
| The body fails to decode         | `asset:failed` with the resolved `url` | Rejects with the decode error.    |

A model whose glTF decodes but whose texture does not is the value arriving: the
material's `map` is left unset, `asset:loaded` is emitted, and the promise
resolves to the model.

A game that treats a missing file as fatal lets the rejection escape its
`initialize`, which rejects `engine.initialize` with the cause and runs no
frame. A game with a fallback catches it and returns a state built around what
did arrive.

```ts
async initialize(api) {
  const badge = await api.assets.loadImage("ui/badge.png").catch(() => null);
  return [{ badge, score: 0 }, null];
}
```
