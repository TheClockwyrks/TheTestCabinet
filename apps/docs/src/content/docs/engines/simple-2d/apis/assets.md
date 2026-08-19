---
title: Assets
---

The asset loader is reached as `engine.assets`. Every path it is given resolves
under one fixed root, and every load it performs is recorded.

## The asset root

The root is `assets/`, relative to the page the build is served from. A path is
written relative to that root, and `resolve` is the concatenation of the two.

```ts
engine.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

## AssetLoader

```ts
resolve(path: string): string;
load(path: string): Promise<Blob>;
log(): AssetEvent[];
```

| Member | Behaviour |
| --- | --- |
| `resolve` | Returns the URL `path` loads from. Pure: it neither fetches nor logs. Throws when the path would name a location outside the root. |
| `load` | Resolves the path, fetches it, and resolves to the response body as a `Blob`. Appends exactly one log entry per call. |
| `log` | Every load attempt, oldest first, as a copy the caller owns. |

## Path rules

`resolve` accepts a non-empty relative path with no `..` segment and no URI
scheme, and throws otherwise.

| Path | Result |
| --- | --- |
| `"sprites/ship.png"` | `"assets/sprites/ship.png"` |
| `"audio/theme.ogg"` | `"assets/audio/theme.ogg"` |
| `""` | Throws: the path is empty. |
| `"/sprites/ship.png"` | Throws: a leading `/` leaves the root. |
| `"../secrets.txt"` | Throws: a `..` segment leaves the root. |
| `"https://example.com/ship.png"` | Throws: an absolute URL is not an asset path. |

## AssetEvent

```ts
interface AssetEvent {
  path: string;
  url: string;
  ok: boolean;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `path` | `string` | The path the game passed to `load`. |
| `url` | `string` | The URL it resolved to, or `""` for a refused path. |
| `ok` | `boolean` | `true` once the response body has been read in full. |

## Load outcomes

`load` records the attempt in every case, and rejects whenever the `Blob` did
not arrive. The rejection carries the original cause unchanged, so the caller
sees the refused path, the HTTP status, or the network error itself.

| Condition | Log entry | Promise |
| --- | --- | --- |
| The body arrives in full | `url` resolved, `ok: true` | Resolves to the `Blob`. |
| The path is refused | `url: ""`, `ok: false` | Rejects with the `resolve` error. |
| The response status is not `2xx` | `url` resolved, `ok: false` | Rejects, naming the status. |
| The fetch fails | `url` resolved, `ok: false` | Rejects with the fetch error. |

## Exports

`AssetEvent` is exported as a type from `@test-cabinet/simple-2d`. `AssetLoader`
is exported as a type only, since the engine constructs the loader.
