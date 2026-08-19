# Assets

Every asset a game loads lives under one fixed root, `assets/`, and every load is
recorded.

```ts
engine.assets.load(path: string): Promise<Blob>;
engine.assets.resolve(path: string): string;
engine.assets.log(): AssetEvent[];
```

## The root

A path is relative to `assets/`, and `resolve` is the concatenation:

```ts
engine.assets.resolve("sprites/ship.png"); // "assets/sprites/ship.png"
```

Put the game's files under `assets/` in the workspace and name them relative to
it.

## `load`

`load` fetches the asset and resolves to a `Blob`:

```ts
const blob = await engine.assets.load("sprites/ship.png");
const image = new Image();
image.src = URL.createObjectURL(blob);
await image.decode();

engine.frame.run({
  update(dt) { ship.x += ship.vx * dt; },
  render(ctx) { ctx.drawImage(image, ship.x, ship.y); },
});
```

Load assets before starting the frame loop, or guard the draw so a frame that
runs before the asset arrives still renders:

```ts
let sprite: HTMLImageElement | null = null;

void engine.assets.load("sprites/ship.png").then(async (blob) => {
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  await image.decode();
  sprite = image;
});
```

`load` rejects when the path is refused and when the fetch fails or returns a
non-`2xx` status. The rejection carries the real cause, and the attempt is
recorded either way.

`resolve` is the pure half: it computes the URL and neither fetches nor records,
so it is what to use when the browser will do the loading:

```ts
const img = document.createElement("img");
img.src = engine.assets.resolve("sprites/ship.png");
```

## Paths stay inside the root

A path that would name a location outside `assets/` is refused, and `resolve`
throws:

| Path | Result |
| --- | --- |
| `"sprites/ship.png"` | `"assets/sprites/ship.png"` |
| `"audio/theme.ogg"` | `"assets/audio/theme.ogg"` |
| `""` | Throws: the path is empty. |
| `"/sprites/ship.png"` | Throws: a leading `/` leaves the root. |
| `"../secrets.txt"` | Throws: a `..` segment leaves the root. |
| `"https://example.com/ship.png"` | Throws: an absolute URL is not an asset path. |

Keep every path relative, with no `..` segment and no scheme.

## The asset log

```ts
interface AssetEvent {
  path: string;  // what the game asked for
  url: string;   // what it resolved to; "" for a refused path
  ok: boolean;   // whether the body arrived in full
}
```

`log()` returns one entry per `load` call, oldest first, as a copy. A refused
path is recorded with an empty `url` and `ok: false`, which distinguishes it from
a file that resolved and was missing.
