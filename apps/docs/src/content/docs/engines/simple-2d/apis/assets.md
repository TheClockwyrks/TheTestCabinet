---
title: Assets
---

A game loads what it needs during initialization, from
[`InitApi.assets`](/engines/simple-2d/apis/game/), and keeps the results in its
state. Every path resolves under one root, and every load announces its outcome
as an engine event.

## The asset root

The root is [`EngineOptions.assetRoot`](/engines/simple-2d/apis/engine/),
defaulting to `assets/` and relative to the page the build is served from. A
path is written relative to that root, and `resolve` is the concatenation of the
two.

```ts
api.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

## Loading

```ts
readonly assets: {
  loadImage(path: string): Promise<ImageBitmap>;
  loadAudio(path: string): Promise<AudioBuffer>;
  load(path: string): Promise<Blob>;
  resolve(path: string): string;
};
```

| Member      | Behavior                                                                               |
| ----------- | -------------------------------------------------------------------------------------- |
| `loadImage` | Resolves the path, fetches it, and decodes the body to an `ImageBitmap` ready to draw. |
| `loadAudio` | Resolves the path, fetches it, and decodes the body to an `AudioBuffer` ready to play. |
| `load`      | Resolves the path, fetches it, and resolves to the response body as a `Blob`.          |
| `resolve`   | Returns the URL `path` loads from. Pure: it neither fetches nor emits.                 |

Each of the three loaders emits exactly one event per call. `resolve` is the
shared first step, so a path any loader refuses is refused identically by all of
them.

Because a game awaits its loads inside `initialize`, every field of its state is
present by the time a frame can observe it, and `update` and `render` read
assets as plain values.

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme.

| Path                             | Result                                        |
| -------------------------------- | --------------------------------------------- |
| `"sprites/ship.png"`             | `"assets/sprites/ship.png"`                   |
| `"audio/theme.ogg"`              | `"assets/audio/theme.ogg"`                    |
| `""`                             | Throws: the path is empty.                    |
| `"/sprites/ship.png"`            | Throws: a leading `/` leaves the root.        |
| `"../secrets.txt"`               | Throws: a `..` segment leaves the root.       |
| `"https://example.com/ship.png"` | Throws: an absolute URL is not an asset path. |

## Events

Loading reports itself through the engine's [event
broadcaster](/engines/simple-2d/apis/game/), subscribed with
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
[`engine.events`](/engines/simple-2d/apis/engine/) before
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
