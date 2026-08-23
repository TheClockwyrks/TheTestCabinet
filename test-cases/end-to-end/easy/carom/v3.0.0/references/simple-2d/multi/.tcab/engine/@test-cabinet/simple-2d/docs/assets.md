# Assets

A game loads what it needs during `initialize`, from `InitApi.assets`, and keeps
the results in its state. Every path resolves under one root, and every load
announces its outcome as an engine event.

```ts
api.assets.loadImage(path: string): Promise<ImageBitmap>;
api.assets.loadAudio(path: string): Promise<AudioBuffer>;
api.assets.load(path: string): Promise<Blob>;
api.assets.resolve(path: string): string;
```

| Member | Behavior |
| --- | --- |
| `loadImage` | Resolves the path, fetches it, and decodes the body to an `ImageBitmap` ready to draw. |
| `loadAudio` | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play. |
| `load` | Resolves the path, fetches it, and resolves to the response body as a `Blob`. |
| `resolve` | Returns the URL `path` loads from. Pure: it neither fetches nor emits. |

## The asset root

The root is `EngineOptions.assetRoot`, defaulting to `assets/` and relative to
the page the build is served from. A path is written relative to that root, and
`resolve` is the concatenation of the two.

```ts
api.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

## Loading into the state

Await the loads inside `initialize` and store the results, so every field of the
state is present by the time a frame can observe it and `update` and `render`
read assets as plain values:

```ts
interface State {
  ship: ImageBitmap;
  x: number;
}

const game: Game<State, null> = {
  async initialize(api) {
    const ship = await api.assets.loadImage("sprites/ship.png");
    return [{ ship, x: 320 }, null];
  },
  update(state, api, dt) {
    state.x += 60 * dt;
  },
  render(state, api) {
    api.ctx.drawImage(state.ship, state.x, 180);
  },
};
```

Loading several assets at once is an ordinary `Promise.all`:

```ts
async initialize(api) {
  const [ship, rock] = await Promise.all([
    api.assets.loadImage("sprites/ship.png"),
    api.assets.loadImage("sprites/rock.png"),
  ]);
  return [{ ship, rock, x: 320 }, null];
}
```

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme, so every request a build makes lands under the root.

| Path | Result |
| --- | --- |
| `"sprites/ship.png"` | `"assets/sprites/ship.png"` |
| `"audio/theme.ogg"` | `"assets/audio/theme.ogg"` |
| `""` | Throws: the path is empty. |
| `"/sprites/ship.png"` | Throws: a leading `/` leaves the root. |
| `"../secrets.txt"` | Throws: a `..` segment leaves the root. |
| `"https://example.com/ship.png"` | Throws: an absolute URL is not an asset path. |

`resolve` is the shared first step of all three loaders, so a path any one of
them refuses is refused identically by all of them.

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

Each of the three loaders emits exactly one event per call. Subscribing to
`asset:failed` on `engine.events` before `engine.initialize` is what lets a
caller observe the game's own loading, since the engine exists before any game
code has run.

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

A game that treats a missing file as fatal lets the rejection escape its
`initialize`, which rejects `engine.initialize` with the cause and runs no
frame. A game with a fallback catches it and returns a state built around what
did arrive.

```ts
async initialize(api) {
  const ship = await api.assets
    .loadImage("sprites/ship.png")
    .catch(() => null);
  return [{ ship, x: 320 }, null];
}
```
