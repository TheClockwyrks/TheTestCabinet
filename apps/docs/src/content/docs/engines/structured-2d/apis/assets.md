---
title: Assets
---

A game loads what it needs from `InitApi.assets`, a level's `LoadApi.assets`, or
[`world.assets`](/engines/structured-2d/apis/worlds/), which are the same four
members reached from three places. Every path resolves under one root, and every
load announces its outcome as an engine event.

## The asset root

The root is [`EngineOptions.assetRoot`](/engines/structured-2d/apis/engine/),
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

## Where a game loads

| Surface                                                 | Loads                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `InitApi.assets`, from the game instance's `initialize` | What the whole game needs. The instance holds the result, and it survives every level transition. |
| `LoadApi.assets`, from a level's `load`                 | What one level needs. The engine awaits it before the world is built.                             |
| `world.assets`, from a tick                             | What a running world discovers it needs. The load is in flight while frames continue.             |

A level's `load` is awaited before any actor exists, so an actor constructed for
that level reads its image as a plain value and hands it straight to a
[`SpriteComponent`](/engines/structured-2d/apis/components/).

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
broadcaster](/engines/structured-2d/apis/engine/), subscribed with
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
[`engine.events`](/engines/structured-2d/apis/engine/) before
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

A rejection that escapes the game instance's `initialize` or the start level's
`load` rejects `engine.initialize` with the cause. A game with a fallback
catches the rejection where it made the call.
