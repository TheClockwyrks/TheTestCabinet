# Assets

A game loads what it needs from `InitApi.assets`, a level's `LoadApi.assets`, or
`world.assets`, which are the same six members reached from three places. Every
path resolves under one root, and every load announces its outcome as an engine
event.

```ts
api.assets.loadImage(path: string): Promise<ImageBitmap>;
api.assets.loadTexture(path: string): Promise<THREE.Texture>;
api.assets.loadModel(path: string): Promise<Model>;
api.assets.loadAudio(path: string): Promise<AudioBuffer>;
api.assets.load(path: string): Promise<Blob>;
api.assets.resolve(path: string): string;
```

| Member | Behavior |
| --- | --- |
| `loadImage` | Resolves the path, fetches it, and decodes the body to an `ImageBitmap` ready for a `SpriteComponent`. |
| `loadTexture` | Resolves the path, fetches it, decodes the body as an image, and wraps it as a `THREE.Texture` in the sRGB color space, ready to use as a `MaterialSpec`'s `map`. |
| `loadModel` | Resolves the path, fetches it, and decodes the body as a glTF 2.0 model, `.glb` or `.gltf`, to a `Model`. |
| `loadAudio` | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play. |
| `load` | Resolves the path, fetches it, and resolves to the response body as a `Blob`. |
| `resolve` | Returns the URL `path` loads from. Pure: it neither fetches nor emits. |

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

`resolve` is what to use where the browser does the loading:

```ts
const img = document.createElement("img");
img.src = api.assets.resolve("ui/logo.png");
```

## Where a game loads

| Surface | Loads |
| --- | --- |
| `InitApi.assets`, from the instance's `initialize` | What the whole game needs. The instance holds the result, and it survives every level transition. |
| `LoadApi.assets`, from a level's `load` | What one level needs. The engine awaits it before the world is built. |
| `world.assets`, from a tick | What a running world discovers it needs. The load is in flight while frames continue. |

A level's `load` is awaited before any actor exists, so an actor constructed for
that level reads its texture or its model as a plain value and hands it straight
to a component. Hold what `load` produced in a module the actors import:

```ts
// ./assets.ts
import type { Model } from "@test-cabinet/structured-3d";
import type * as THREE from "three";

export interface Loaded {
  ship: Model;
  hull: THREE.Texture;
}

let loaded: Loaded | null = null;

export function setLoaded(value: Loaded): void {
  loaded = value;
}

/** The level's assets. Throws before the level's `load` has resolved. */
export function assets(): Loaded {
  if (loaded === null) throw new Error("the arena's assets are not loaded");
  return loaded;
}
```

```ts
// ./levels.ts
import type { LevelDefinition } from "@test-cabinet/structured-3d";
import { ArenaMode } from "./modes";
import { setLoaded } from "./assets";

export const arena: LevelDefinition = {
  mode: ArenaMode,
  actors: [/* ... */],
  async load(api) {
    const [ship, hull] = await Promise.all([
      api.assets.loadModel("models/ship.glb"),
      api.assets.loadTexture("textures/hull.png"),
    ]);
    setLoaded({ ship, hull });
  },
};
```

```ts
// ./actors.ts
import { Actor, MeshComponent, ModelComponent } from "@test-cabinet/structured-3d";
import { assets } from "./assets";

export class Ship extends Actor {
  constructor() {
    super();
    this.attach(new ModelComponent({ model: assets().ship, animation: "idle" }));
  }
}

export class Ground extends Actor {
  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 40, height: 0.2, depth: 40 },
        material: { map: assets().hull },
      }),
    );
  }
}
```

An accessor rather than a bare record: the level's `load` is awaited before any
actor of that level exists, so `assets()` is always populated by the time a
constructor reaches it, and the value it hands back is the asset itself rather
than one that might be missing. A build whose modules read a bare
`Record<string, Model>` has to narrow at every use instead.

Loading several assets at once is an ordinary `Promise.all`. A world that
discovers a need mid-run loads through `world.assets` and installs the result
when it arrives.

## Textures

`loadTexture` hands back a `THREE.Texture` already in the sRGB color space, so
assigning it as a material's `map` shows the colors the image file carries.
`color` multiplies the map, so the default white leaves the image as loaded, and
the texture is sampled by three under its own filtering rather than under
`EngineOptions.imageSmoothing`, which governs the screen layer alone.

A texture is a three object, so a game that wants to tile or repeat it writes
three's own fields on it before handing it to a material spec:

```ts
import * as THREE from "three";

const grid = await api.assets.loadTexture("textures/grid.png");
grid.wrapS = THREE.RepeatWrapping;
grid.wrapT = THREE.RepeatWrapping;
grid.repeat.set(8, 8);
```

## Models

```ts
interface Model {
  readonly scene: THREE.Group;
  readonly animations: readonly THREE.AnimationClip[];
  readonly nodes: readonly string[];
}
```

| Field | Meaning |
| --- | --- |
| `scene` | The decoded node tree, a template. |
| `animations` | Every animation clip the file carries, each named as the file names it. |
| `nodes` | Every node name in the tree, in traversal order. |

`loadModel` decodes glTF 2.0: the node hierarchy, meshes with their attributes,
materials, skins, and animations. A `.glb` carries everything in one file; a
`.gltf` file's external buffers and images are fetched relative to that file's
own URL inside the same load.

**A model is a template.** A `ModelComponent` clones it on construction, with a
skinned mesh bound to its own copy of the skeleton, so one `Model` backs any
number of components and each animates on its own. `animations` names what
`ModelComponent.play` accepts, and `nodes` names what `ModelComponent.node`
hands back a handle for, so a build checks what an exporter wrote before it
plays a clip or drives a joint:

```ts
const ship = await api.assets.loadModel("models/ship.glb");
const clips = ship.animations.map((clip) => clip.name); // ["idle", "bank"]
const hasTurret = ship.nodes.includes("turret");
```

See `models-and-animation.md` for placing, animating, and posing one.

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme, so every request a build makes lands under the root.

| Path | Result |
| --- | --- |
| `"models/ship.glb"` | `"assets/models/ship.glb"` |
| `"textures/hull.png"` | `"assets/textures/hull.png"` |
| `"audio/theme.ogg"` | `"assets/audio/theme.ogg"` |
| `""` | Throws: the path is empty. |
| `"/models/ship.glb"` | Throws: a leading `/` leaves the root. |
| `"../secrets.txt"` | Throws: a `..` segment leaves the root. |
| `"https://example.com/ship.glb"` | Throws: an absolute URL is not an asset path. |

## Events

Loading reports itself through the engine's event broadcaster, subscribed with
`events.on(name, handler)`.

```ts
"asset:loaded": { path: string; url: string };
"asset:failed": { path: string; url: string; reason: string };
```

| Field | Meaning |
| --- | --- |
| `path` | The path the game passed to the loader. |
| `url` | The URL it resolved to, or `""` for a refused path. |
| `reason` | Why the load failed: the refusal, the HTTP status, the network error, or the decode error. |

Subscribing to `asset:failed` on `engine.events` before `engine.initialize` is
what lets a caller observe the game's own loading, since the engine exists
before any game code has run. The subscription lives on the engine, so it also
observes the loads every later level performs.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`asset ${event.path} failed: ${event.reason}`);
});

const instance = await engine.initialize();
```

Nothing accumulates a record of the assets a run loaded; a subscriber keeps
exactly what it needs.

## Load outcomes

Every loader announces the attempt in every case, and rejects whenever the value
did not arrive. The rejection carries the original cause unchanged, so the
caller sees the refused path, the HTTP status, or the network error itself.

| Condition | Event | Promise |
| --- | --- | --- |
| The value arrives | `asset:loaded` with the resolved `url` | Resolves to the value. |
| The path is refused | `asset:failed` with `url: ""` | Rejects with the `resolve` error. |
| The response status is not `2xx` | `asset:failed` with the resolved `url` | Rejects, naming the status. |
| The fetch fails | `asset:failed` with the resolved `url` | Rejects with the fetch error. |
| The body fails to decode | `asset:failed` with the resolved `url` | Rejects with the decode error. |

A model whose glTF decodes but whose texture does not is the value arriving: the
material's `map` is left unset, `asset:loaded` is emitted, and the promise
resolves to the model.

A rejection that escapes the instance's `initialize` or the start level's `load`
rejects `engine.initialize` with the cause, and no frame runs. A game with a
fallback catches the rejection where it made the call and builds around what did
arrive:

```ts
async load(api) {
  const hull = await api.assets.loadTexture("textures/hull.png").catch(() => null);
  setLoaded({ ship: await api.assets.loadModel("models/ship.glb"), hull });
}
```

`Loaded` declares `hull` as `THREE.Texture | null`, and an actor falls back to a
declared color where the texture is absent:

```ts
const { hull } = assets();
this.attach(
  new MeshComponent({
    geometry: GROUND,
    material: hull === null ? { color: PALETTE.ground } : { map: hull },
  }),
);
```
