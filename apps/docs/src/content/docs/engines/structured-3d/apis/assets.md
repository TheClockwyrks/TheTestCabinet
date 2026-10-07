---
title: Assets
---

A game loads what it needs from `InitApi.assets`, a level's `LoadApi.assets`, or
[`world.assets`](/engines/structured-3d/apis/worlds/), which are the same six
members reached from three places. Every path resolves under one root, and every
load announces its outcome as an engine event.

## The asset root

The root is [`EngineOptions.assetRoot`](/engines/structured-3d/apis/engine/),
defaulting to `assets/` and relative to the page the build is served from. A
path is written relative to that root, and `resolve` is the concatenation of the
two.

```ts
api.assets.resolve("models/ship.glb"); // "assets/models/ship.glb"
```

## Loading

```ts
readonly assets: {
  loadImage(path: string): Promise<ImageBitmap>;
  loadTexture(path: string): Promise<THREE.Texture>;
  loadModel(path: string): Promise<Model>;
  loadAudio(path: string): Promise<AudioBuffer>;
  load(path: string): Promise<Blob>;
  resolve(path: string): string;
};
```

| Member        | Behavior                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadImage`   | Resolves the path, fetches it, and decodes the body to an `ImageBitmap` ready to draw on the screen layer.                                                  |
| `loadTexture` | Resolves the path, fetches it, decodes the body as an image, and wraps it as a `THREE.Texture` in the sRGB color space, ready to use as a material's `map`. |
| `loadModel`   | Resolves the path, fetches it, and decodes the body as a glTF 2.0 model, `.glb` or `.gltf`.                                                                 |
| `loadAudio`   | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play.                                                                      |
| `load`        | Resolves the path, fetches it, and resolves to the response body as a `Blob`.                                                                               |
| `resolve`     | Returns the URL `path` loads from. Pure: it neither fetches nor emits.                                                                                      |

Each of the five loaders emits exactly one event per call. `resolve` is the
shared first step, so a path any loader refuses is refused identically by all of
them.

## Where a game loads

| Surface                                                 | Loads                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `InitApi.assets`, from the game instance's `initialize` | What the whole game needs. The instance holds the result, and it survives every level transition. |
| `LoadApi.assets`, from a level's `load`                 | What one level needs. The engine awaits it before the world is built.                             |
| `world.assets`, from a tick                             | What a running world discovers it needs. The load is in flight while frames continue.             |

A level's `load` is awaited before any actor exists, so an actor constructed for
that level reads its image or its model as a plain value and hands it straight
to a [`SpriteComponent`](/engines/structured-3d/apis/components/) or a
[`ModelComponent`](/engines/structured-3d/apis/components/).

## `Model`

```ts
interface Model {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
  readonly nodes: readonly string[];
}
```

| Field        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `scene`      | The decoded node tree, a template.                                      |
| `animations` | Every animation clip the file carries, each named as the file names it. |
| `nodes`      | Every node name in the tree, in traversal order.                        |

`loadModel` decodes glTF 2.0: the node hierarchy, meshes with their attributes,
materials, skins, and animations. A `.glb` carries everything in one file; a
`.gltf` file's external buffers and images are fetched relative to the file's
own URL inside the same load. A texture the host cannot decode leaves that
material's `map` unset, and the load still resolves. The per-part `.glb` files
the voxel binaries emit and the whole-rig GLB `scripts/voxel-to-gltf.mjs`
exports both load this way.

A model's `scene` is a template that a game leaves as loaded. A
`ModelComponent` clones the template on construction, with a skinned mesh bound
to its own copy of the skeleton, so one `Model` backs any number of components
and each animates on its own. `animations` names what
`ModelComponent.play` accepts, and `nodes` names what `ModelComponent.node`
hands back a handle for.

```ts
const ship = await api.assets.loadModel("models/ship.glb");
const clips = ship.animations.map((clip) => clip.name); // ["idle", "bank"]
const hasTurret = ship.nodes.includes("turret");
```

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme.

| Path                             | Result                                        |
| -------------------------------- | --------------------------------------------- |
| `"models/ship.glb"`              | `"assets/models/ship.glb"`                    |
| `"textures/hull.png"`            | `"assets/textures/hull.png"`                  |
| `"audio/theme.ogg"`              | `"assets/audio/theme.ogg"`                    |
| `""`                             | Throws: the path is empty.                    |
| `"/models/ship.glb"`             | Throws: a leading `/` leaves the root.        |
| `"../secrets.txt"`               | Throws: a `..` segment leaves the root.       |
| `"https://example.com/ship.glb"` | Throws: an absolute URL is not an asset path. |

## Events

Loading reports itself through the engine's [event
broadcaster](/engines/structured-3d/apis/engine/), subscribed with
`events.on(name, handler)`.

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
[`engine.events`](/engines/structured-3d/apis/engine/) before
`engine.initialize` is what lets a caller observe the game's own loading, since
the engine exists before any game code has run. The subscription lives on the
engine, so it also observes the loads every later level performs.

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

A model whose file decodes and whose texture does not is a value that arrived:
the load resolves, emits `asset:loaded`, and the material affected has no
`map`. A rejection that escapes the game instance's `initialize` or the start
level's `load` rejects `engine.initialize` with the cause. A game with a
fallback catches the rejection where it made the call.

## Exports

`Model` is exported as a type from `@clockwyrks/structured-3d`.
