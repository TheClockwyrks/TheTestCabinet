# Simple 2D

`@test-cabinet/simple-2d` is the runtime a 2D browser game is built on. It owns
the frame loop, the canvas fit, input, audio, asset loading, and the debug
overlay. The game writes its own simulation and its own drawing, and nothing
else.

## What each side owns

The engine owns:

- The frame loop, its delta time, and the clamp on that delta time.
- Canvas sizing: the letterbox, the centring, and the device pixel ratio.
- Clearing and transforming the drawing context before every frame.
- Keyboard listening, action binding, and edge detection.
- The Web Audio graph, cue synthesis, mute, and the first-interaction unlock.
- Asset URL resolution under the fixed `assets/` root.
- The diagnostics overlay and its toggle key.

The game supplies:

- `update(dt)` and `render(ctx)`.
- Its action registrations, cue definitions, and diagnostic sources.
- Everything drawn inside `render`, in logical coordinates.

## Install and import

The engine is an ordinary dependency, already present in the workspace's
`package.json`:

```ts
import { createEngine } from "@test-cabinet/simple-2d";
```

`TOUCH_LAYOUTS` and every type named in these pages are exported from the same
entry point:

```ts
import { createEngine, TOUCH_LAYOUTS } from "@test-cabinet/simple-2d";
import type { CueSpec, Engine, EngineOptions } from "@test-cabinet/simple-2d";
```

## A complete minimal game

```ts
import { createEngine } from "@test-cabinet/simple-2d";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#101018",
});

engine.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
engine.input.register("right", { keys: ["ArrowRight", "KeyD"] });
engine.input.register("fire", { keys: ["Space"] });
engine.audio.define("shot", { wave: "square", freq: 660, freqTo: 220, durationMs: 90 });

const SPEED = 260; // logical pixels per second
const player = { x: 320, y: 320 };
let shots = 0;

engine.diagnostics.register("x", () => player.x);
engine.diagnostics.register("shots", () => shots);

engine.frame.run({
  update(dt) {
    const dir = engine.input.value("right") - engine.input.value("left");
    player.x = Math.min(632, Math.max(8, player.x + dir * SPEED * dt));
    if (engine.input.pressed("fire")) {
      shots += 1;
      engine.audio.play("shot");
    }
  },
  render(ctx) {
    ctx.fillStyle = "#7fd1ff";
    ctx.fillRect(player.x - 8, player.y - 8, 16, 16);
  },
});
```

## `createEngine(options)`

```ts
function createEngine(options: EngineOptions): Engine;
```

| Option | Type | Meaning |
| --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | The canvas the engine sizes and draws through. |
| `width` | `number` | Logical design width, in logical pixels. |
| `height` | `number` | Logical design height, in logical pixels. |
| `background` | `string?` | A CSS colour filled before every frame; else transparent. |
| `layout` | `string?` | A touch layout name, as `input.useLayout(name)` would select. |

`createEngine` throws when `width` or `height` is not a positive finite number,
and when the canvas cannot supply a 2D context. Both failures are unrecoverable,
and both otherwise present as a game that runs but draws nothing.

Call it once, after the canvas is in the document.

## The `Engine` object

| Member | Type | Page |
| --- | --- | --- |
| `frame` | `{ run(cb), stop(), info() }` | [frame.md](./frame.md) |
| `input` | `InputRegistry` | [input.md](./input.md) |
| `audio` | `AudioBus` | [audio.md](./audio.md) |
| `assets` | `AssetLoader` | [assets.md](./assets.md) |
| `diagnostics` | `Diagnostics` | [diagnostics.md](./diagnostics.md) |
| `viewport` | `() => Viewport` | Below. |
| `destroy` | `() => void` | Below. |

`engine.destroy()` stops the loop and removes every listener the engine
installed. It is idempotent. A game that runs for the life of the page never
needs it.

## Logical size and letterboxing

A game draws in a fixed logical design size — the `width` × `height` given to
`createEngine` — and never reads the canvas element's size. The engine maps that
field onto the canvas once per frame:

- The scale is uniform, the smaller of `elementWidth / width` and
  `elementHeight / height`, so the aspect ratio is preserved and the whole
  logical field stays visible.
- The leftover space on the long axis is split into two equal bars, so the field
  is centred.
- The device pixel ratio is folded into the scale, and the canvas backing store
  is resized to match, so the picture is sharp on a high-density display.

This is redone at the top of every frame, so a window resize, a device pixel
ratio change, and a layout change all correct themselves with no resize handler.

The `ctx` handed to `render` already carries this transform. Drawing at
`(0, 0)` is the top-left of the logical field and `(width, height)` is its
bottom-right, whatever size the element happens to be.

Style the canvas element however the page needs; the engine leaves an existing
CSS size alone. A full-window game is ordinary CSS:

```ts
canvas.style.width = "100vw";
canvas.style.height = "100vh";
```

`engine.viewport()` reports the current fit as a snapshot the caller owns:

```ts
interface Viewport {
  readonly width: number;  // logical design width
  readonly height: number; // logical design height
  scale: number;           // device pixels per logical unit
  offsetX: number;         // left letterbox bar, in device pixels
  offsetY: number;         // top letterbox bar, in device pixels
}
```

`scale` and the offsets are in device pixels. To map a pointer event's CSS-space
position into logical coordinates:

```ts
const vp = engine.viewport();
const dpr = window.devicePixelRatio || 1;
const rect = canvas.getBoundingClientRect();
const logicalX = ((event.clientX - rect.left) * dpr - vp.offsetX) / vp.scale;
const logicalY = ((event.clientY - rect.top) * dpr - vp.offsetY) / vp.scale;
```

A canvas whose element has no size yet reports `scale: 0`. Drawing that frame
lands nothing and the next frame recovers on its own.

## Order of work in one frame

1. The canvas is resynced to its element and the device pixel ratio.
2. The frame is cleared, to `background` or to transparency.
3. The viewport transform is applied to the context.
4. `update(dt)` runs.
5. `render(ctx)` runs against that transformed context.
6. The diagnostics overlay is drawn, in device pixels, over the finished picture.
7. Unconsumed input edges are discarded.

Because step 2 clears the whole canvas, every frame draws the complete picture.

## Contents

| Page | Covers |
| --- | --- |
| [frame.md](./frame.md) | `run`, `stop`, delta time, and integrating against it. |
| [input.md](./input.md) | Actions, key bindings, held and edge reads, touch layouts. |
| [audio.md](./audio.md) | Cue definitions, playback, mute, and the unlock. |
| [assets.md](./assets.md) | The `assets/` root, `load`, and `resolve`. |
| [diagnostics.md](./diagnostics.md) | Overlay sources and the toggle. |
