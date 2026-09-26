---
title: Assets
---

A game loads what it needs during initialization, from
[`InitApi.assets`](/engines/simple-3d/apis/game/), and keeps the results where
each is read from: decoded images and audio in its state, textures and models
in its render-side cache beside the retained scene. Every path resolves under
one root, and every load announces its outcome as an engine event.

## The asset root

The root is [`EngineOptions.assetRoot`](/engines/simple-3d/apis/engine/),
defaulting to `assets/` and relative to the page the build is served from. A
path is written relative to that root, and `resolve` is the concatenation of the
two.

```ts
api.assets.resolve("models/ship.glb"); // "assets/models/ship.glb"
```

## Loading

```ts
import type * as THREE from "three";

readonly assets: {
  loadImage(path: string): Promise<ImageBitmap>;
  loadTexture(path: string): Promise<THREE.Texture>;
  loadModel(path: string): Promise<Model>;
  loadAudio(path: string): Promise<AudioBuffer>;
  load(path: string): Promise<Blob>;
  resolve(path: string): string;
};
```

| Member        | Behavior                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadImage`   | Resolves the path, fetches it, and decodes the body to an `ImageBitmap` ready to draw on the screen layer.                                                        |
| `loadTexture` | Resolves the path, fetches it, decodes the body, and wraps the decoded image as a `THREE.Texture` in the sRGB color space, ready to assign as a material's `map`. |
| `loadModel`   | Resolves the path, fetches it, and decodes the body as a glTF 2.0 model, `.glb` or `.gltf`, to a [`Model`](#models).                                              |
| `loadAudio`   | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play.                                                                            |
| `load`        | Resolves the path, fetches it, and resolves to the response body as a `Blob`.                                                                                     |
| `resolve`     | Returns the URL `path` loads from. Pure: it neither fetches nor emits.                                                                                            |

Each of the five loaders emits exactly one event per call. `resolve` is the
shared first step, so a path any loader refuses is refused identically by all of
them.

Because a game awaits its loads inside `initialize`, every value it loads is
present by the time a frame can observe it. Images and audio buffers are plain
values the state carries, and `update` and `render` read them as such. A
texture or a model is a three object, which the state never carries; a game
keeps it in a module-level cache, or places a model's clone in
[`InitApi.scene`](/engines/simple-3d/apis/game/) during initialization.

## Models

```ts
import type * as THREE from "three";

interface Model {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
  readonly nodes: readonly string[];
}

function cloneModel(model: Model): THREE.Group;
```

| Member       | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| `scene`      | The decoded node tree, a template.                                                |
| `animations` | Every animation clip the file carries, playable through a three `AnimationMixer`. |
| `nodes`      | Every node name in the tree, in traversal order.                                  |

`loadModel` decodes glTF 2.0: the node hierarchy, meshes with their attributes,
materials, skins, and animations. A texture the host cannot decode leaves that
material's `map` unset, and the load still resolves. The per-part `.glb` files
the voxel binaries emit and the whole-rig GLB `scripts/voxel-to-gltf.mjs`
exports both load this way.

A model's `scene` is a template. A game places a model by cloning it with
`cloneModel`, a deep clone that keeps a skinned mesh bound to its own skeleton,
and adds the clone to the scene; one template yields as many placed copies as
the game needs, each posed independently.

```ts
import * as THREE from "three";
import { cloneModel, type Model } from "@clockwyrks/simple-3d";

const templates = new Map<string, Model>();
const ships = new Map<string, THREE.Group>();

// In initialize.
templates.set("ship", await api.assets.loadModel("models/ship.glb"));

// In render, for each ship the state carries.
let object = ships.get(ship.id);
if (!object) {
  object = cloneModel(templates.get("ship")!);
  api.scene.add(object);
  ships.set(ship.id, object);
}
object.position.set(ship.x, ship.y, ship.z);
```

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme.

| Path                             | Result                                        |
| -------------------------------- | --------------------------------------------- |
| `"models/ship.glb"`              | `"assets/models/ship.glb"`                    |
| `"audio/theme.ogg"`              | `"assets/audio/theme.ogg"`                    |
| `""`                             | Throws: the path is empty.                    |
| `"/models/ship.glb"`             | Throws: a leading `/` leaves the root.        |
| `"../secrets.txt"`               | Throws: a `..` segment leaves the root.       |
| `"https://example.com/ship.glb"` | Throws: an absolute URL is not an asset path. |

## Events

Loading reports itself through the engine's [event
broadcaster](/engines/simple-3d/apis/game/), subscribed with
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

Subscribing to `asset:failed` on
[`engine.events`](/engines/simple-3d/apis/engine/) before
`engine.initialize` is what lets a caller observe the game's own loading, since
the engine exists before any game code has run.

## Load outcomes

Every loader announces the attempt in every case, and rejects whenever the value
did not arrive. The rejection carries the original cause unchanged, so the
caller sees the refused path, the HTTP status, or the network error itself.

| Condition                        | Event                                  | Promise                           |
| -------------------------------- | -------------------------------------- | --------------------------------- |
| The value arrives                | `asset:loaded` with the resolved `url` | Resolves to the value.            |
| The path is refused              | `asset:failed` with `url: ""`          | Rejects with the `resolve` error. |
| The response status is not `2xx` | `asset:failed` with the resolved `url` | Rejects, naming the status.       |
| The fetch fails                  | `asset:failed` with the resolved `url` | Rejects with the fetch error.     |
| The body fails to decode         | `asset:failed` with the resolved `url` | Rejects with the decode error.    |

A model whose glTF decodes but whose texture does not is the value arriving:
the material's `map` is left unset, `asset:loaded` is emitted, and the promise
resolves to the model.

## Exports

`Model` is exported as a type and `cloneModel` as a function from
`@clockwyrks/simple-3d`.
