# Assets

A game loads what it needs during `initialize`, from `InitApi.assets`, and keeps
the handles in its state. Every path resolves under one root, and every load
announces its outcome as an engine event.

```ts
api.assets.loadMesh(path: string): Promise<MeshHandle>;
api.assets.loadTexture(path: string): Promise<TextureHandle>;
api.assets.loadMaterial(path: string): Promise<MaterialHandle>;
api.assets.loadAudio(path: string): Promise<AudioBuffer>;
api.assets.load(path: string): Promise<Blob>;
api.assets.resolve(path: string): string;
```

| Member | Behavior |
| --- | --- |
| `loadMesh` | Resolves the path, fetches it, and decodes a glTF binary (`.glb`) to a `MeshHandle` ready to draw. |
| `loadTexture` | Resolves the path, fetches it, and decodes the image to a `TextureHandle` ready to use as a texture. |
| `loadMaterial` | Resolves the path, fetches and parses the material document, loads every map it names, and resolves to a `MaterialHandle`. |
| `loadAudio` | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play. |
| `load` | Resolves the path, fetches it, and resolves to the response body as a `Blob`. |
| `resolve` | Returns the URL `path` loads from. Pure: it neither fetches nor emits. |

There is no `loadImage`: a texture is the 3D engine's image. A file the typed
loaders do not cover — level data, a voxel `rig.json`, a font — goes through
`load`. The typed loaders line up with the asset kinds the asset-generation
tools produce: `mesh.glb` from the meshed model kinds, `material.json` with its
PBR maps from the material kind, and `clip.wav` from the audio kinds. A texture
is a PNG and audio is a PCM WAV; the engine decodes both itself, so a load
resolves identically in a browser and headlessly.

Each loader call fetches; nothing is cached across calls.

## The asset root

The root is `EngineOptions.assetRoot`, defaulting to `assets/` and relative to
the page the build is served from. A path is written relative to that root, and
`resolve` is the concatenation of the two.

```ts
api.assets.resolve("models/ship.glb"); // "assets/models/ship.glb"
```

## Handles

A handle is an engine-owned, immutable value: the game holds it in its state and
hands it back to the engine through a scene-context draw call. Its identity is
the load that produced it, and its readable fields are exactly these:

```ts
interface MeshHandle {
  readonly path: string;
  readonly bounds: Box3;
  readonly nodes: readonly string[];
  readonly clips: readonly string[];
}

interface TextureHandle {
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

type MaterialMapSlot =
  | "baseColor" | "normal" | "roughness" | "metallic" | "ao" | "emissive" | "height";

interface MaterialHandle {
  readonly path: string;
  readonly maps: Readonly<Partial<Record<MaterialMapSlot, TextureHandle>>>;
}
```

| Field | Meaning |
| --- | --- |
| `path` | The path the handle was loaded from, as the game passed it. |
| `MeshHandle.bounds` | The mesh's axis-aligned bounds in its own local units. |
| `MeshHandle.nodes` | The named nodes the file carries, in file order. |
| `MeshHandle.clips` | The named animation clips the file carries, in file order. |
| `TextureHandle.width`/`height` | The decoded size in pixels. |
| `MaterialHandle.maps` | The loaded texture per map slot the document names. |

`drawMesh` takes the `MeshHandle`, `drawBillboard` a `TextureHandle`, and a
`MaterialHandle` slots in wherever a material is accepted. `mesh.clips` is what
`DrawMeshOptions.clip` must name, and `mesh.bounds` is what a game's own
collision arithmetic and picking work against. See `drawing.md`.

## Loading into the state

Await the loads inside `initialize` and store the handles, so every field of the
state is present by the time a frame can observe it and `update` and `render`
read assets as plain values:

```ts
interface State {
  readonly ship: MeshHandle;
  readonly level: Blob;
  readonly player: Vec3;
}

const game: Game<State, null> = {
  async initialize(api) {
    const [ship, level] = await Promise.all([
      api.assets.loadMesh("models/ship.glb"),
      api.assets.load("levels/01.json"),
    ]);
    return [{ ship, level, player: { x: 0, y: 0, z: 0 } }, null];
  },
  update(state, _api, dt) {
    return step(state, dt);
  },
  render(state, api) {
    api.scene.drawMesh(state.ship, {
      position: state.player,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
  },
};
```

## Material documents

A material document names its maps by paths relative to the document's own
directory under the asset root, so a material and its textures travel as one
folder and one path in the build. `loadMaterial` is one call and one event: the
map fetches are inside it, and a map that fails fails the whole load, with
`reason` naming the map. The event's `path` and `url` are the document's.

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme, so every request a build makes lands under the root.

| Path | Result |
| --- | --- |
| `"models/ship.glb"` | `"assets/models/ship.glb"` |
| `"audio/theme.wav"` | `"assets/audio/theme.wav"` |
| `""` | Throws: the path is empty. |
| `"/models/ship.glb"` | Throws: a leading `/` leaves the root. |
| `"../secrets.txt"` | Throws: a `..` segment leaves the root. |
| `"https://example.com/ship.glb"` | Throws: an absolute URL is not an asset path. |

`resolve` is the shared first step of every loader, so a path any one of them
refuses is refused identically by all of them. It performs no fetch, which is
what to use where the browser does the loading:

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("ui/title.png"); // "assets/ui/title.png"
```

## Events

Loading reports itself through the engine's event broadcaster, subscribed with
`api.events.on(name, handler)`.

```ts
"asset:loaded": { path: string; url: string };
"asset:failed": { path: string; url: string; reason: string };
```

| Field | Meaning |
| --- | --- |
| `path` | The path the game passed to the loader. |
| `url` | The URL it resolved to, or `""` for a refused path. |
| `reason` | Why the load failed: the refusal, the HTTP status, the network error, or the decode error. |

Each loader emits exactly one event per call. Subscribing to `asset:failed` on
`engine.events` before `engine.initialize` is what lets a caller observe the
game's own loading, since the engine exists before any game code has run.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`asset ${event.path} failed: ${event.reason}`);
});

const state = await engine.initialize();
```

Nothing accumulates a record of the assets a run loaded; a subscriber keeps
exactly what it needs.

## Load outcomes

Every loader announces the attempt in every case, and rejects whenever the value
did not arrive. The rejection carries the original cause unchanged.

| Condition | Event | Promise |
| --- | --- | --- |
| The value arrives | `asset:loaded` with the resolved `url` | Resolves to the value. |
| The path is refused | `asset:failed` with `url: ""` | Rejects with the `resolve` error. |
| The response status is not `2xx` | `asset:failed` with the resolved `url` | Rejects, naming the status. |
| The fetch fails | `asset:failed` with the resolved `url` | Rejects with the fetch error. |
| The body fails to decode | `asset:failed` with the resolved `url` | Rejects with the decode error. |
| `loadMesh` on a body that is not a glTF binary | `asset:failed` with the resolved `url` | Rejects with the decode error. |
| `loadMaterial` on a document missing its required fields | `asset:failed` with the resolved `url` | Rejects with the decode error. |
| `loadMaterial` on a document naming a map that fails to load | `asset:failed` with the document's `url`, `reason` naming the map | Rejects with the map's error. |

A game that treats a missing file as fatal lets the rejection escape its
`initialize`, which rejects `engine.initialize` with the cause and runs no
frame. A game with a fallback catches it and returns a state built around what
did arrive.

```ts
async initialize(api) {
  const decal = await api.assets.loadTexture("textures/decal.png").catch(() => null);
  return [{ decal, x: 0 }, null];
}
```
