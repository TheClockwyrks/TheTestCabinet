---
title: Creating the Engine
---

The engine is an ordinary dependency of the build's workspace, already present
in its `package.json`. One import brings in the factory.

```ts
import { createEngine } from "@test-cabinet/simple-3d";
```

The clock catalogue, the touch layout catalogue, and every type the engine names
come from the same specifier.

```ts
import { createEngine, PacedClock, TOUCH_LAYOUTS } from "@test-cabinet/simple-3d";
import type { CueSpec, Engine, EngineOptions, Game } from "@test-cabinet/simple-3d";
```

## Pick a logical design size

The width and height handed to `createEngine` are the logical field the HUD and
the pointer live in, and they stay fixed for the life of the build. Their ratio
is also the aspect of the [camera's](/engines/simple-3d/apis/viewport/)
frustum, so the picture is the same on every canvas and the engine letterboxes
it onto whatever size the page gives the element. The world stays in the game's
own units either way; the design size decides only what the world projects
into.

A landscape game is comfortable at `640 × 360`, a portrait one at `480 × 640`.
The number itself matters less than committing to one and writing every HUD
coordinate in it.

## Create it once

`createEngine` binds the game and builds the engine over the canvas. It runs
synchronously and runs no game code, so the engine exists before anything the
game does is observable. [`engine.initialize`](/engines/simple-3d/apis/engine/)
then runs the game's own `initialize` and resolves once the state is built, and
`engine.run` drives frames from there.

```ts
import { createEngine } from "@test-cabinet/simple-3d";
import { game } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  background: "#101018",
});

await engine.initialize();
await engine.run();
```

That ordering is what lets a caller subscribe to
[engine events](/engines/simple-3d/apis/game/) before the game loads anything,
so a failed asset is observed as it happens rather than inferred afterwards.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`asset ${event.path} failed: ${event.reason}`);
});

const opening = await engine.initialize();
```

## The remaining options

| Option | Effect |
| --- | --- |
| `background` | A CSS color the whole canvas is cleared to before every frame. Left out, the frame clears to transparency and the page shows through behind the game. |
| `layout` | Selects a touch layout from `TOUCH_LAYOUTS`, whose vocabulary the game then registers as actions. |
| `assetRoot` | The root every asset path resolves under. Defaults to `assets/`. |
| `surface` | Where the engine reads element size and device pixel ratio and attaches its listeners. Defaults to the canvas and its owning document. |

```ts
const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  layout: "stick-look-two-buttons",
  assetRoot: "assets/",
});
```

A build in the browser takes the default surface. Supplying one is how a
validator runs the same engine over a canvas with no document behind it; the
canvas must yield a WebGL2 context either way.

## Size the canvas

The element's size is the page's business and the fit is the engine's. Give the
canvas a size in whatever CSS units the page wants, inline or through a
stylesheet, and leave the `width` and `height` attributes alone.

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine pins a fixed pixel size onto the canvas only while its reported size
still matches those attributes, which is what stops the backing store from
feeding back into the next measurement. A canvas the page has sized keeps
following its own rule, so it stays free to track the window. A canvas that
fills a sized wrapper takes the same form, with `width: 100%; height: 100%`.

The engine reads the laid-out size at the top of every frame and resizes the
backing store to match the device pixel ratio, so a window resize needs no
handler and no code in the game.

## Choose a clock

A [clock](/engines/simple-3d/apis/clocks/) decides what each frame's delta is,
and the engine holds exactly one. A build that omits the option gets a
`WallClock`, which reports the real time each frame took, clamped so a tab that
stops receiving frames resumes as though the game paused for the gap.

```ts
const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  game,
  clock: new PacedClock(60),
});
```

A `PacedClock` holds a cadence: it declines the ticks that arrive between grid
slots and reports one fixed interval on the ticks it accepts. Choose it for a
game whose feel depends on a steady rate, and for a build whose simulated time
should match the rate it targets.

`engine.setClock` replaces the clock in place, and the frame counter and
accumulated time carry over. The scripted clocks are what a validator installs
to step a scenario reproducibly.

## Tearing down

A game that runs for the life of the page never needs to be torn down. Two
separate acts stop it when a build mounts the game into a view that goes away.

An `AbortSignal` passed to `run` halts the loop and leaves the engine usable, so
the same teardown path that cancels everything else cancels the loop with it.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

`engine.destroy()` halts the loop and detaches every listener. It is idempotent,
and it resolves any promise `run` returned.

```ts
engine.destroy();
```
