---
title: Creating the Engine
---

The engine is an ordinary dependency of the build's workspace, already present
in its `package.json`. One import brings in the factory.

```ts
import { createEngine } from "@test-cabinet/simple-2d";
```

The touch layout catalogue and every type the engine names come from the same
specifier.

```ts
import { createEngine, TOUCH_LAYOUTS } from "@test-cabinet/simple-2d";
import type { CueSpec, Engine, EngineOptions } from "@test-cabinet/simple-2d";
```

## Pick a logical design size

The width and height handed to `createEngine` are the coordinate system the game
is written in, and they stay fixed for the life of the build. Choose a size that
suits the game's aspect ratio and state every speed, size, and distance in those
units; the engine fits that field onto whatever size the page gives the canvas.

A landscape action game is comfortable at `640 × 360`, a puzzle board at
`480 × 640`. The number itself matters less than committing to one and never
reading the canvas element's size again.

## Create it once

Create the engine after the canvas is in the document, and hold the returned
object for the life of the page.

```ts
import { createEngine } from "@test-cabinet/simple-2d";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing #game canvas");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#101018",
});
```

`background` is the CSS colour the whole canvas is filled with before every
frame. Leave it out to clear to transparency instead, so the page shows through
behind the game.

`layout` selects a touch layout from the catalogue, whose vocabulary the game
then registers as actions:

```ts
const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  layout: "dpad-4-two-buttons",
});
```

With the engine built, register the actions, define the cues, and start the
loop.

## Size the canvas

The element's size is the page's business and the fit is the engine's. Express
that size inline on the canvas element, in whatever CSS units the page wants,
and leave the `width` and `height` attributes alone.

```html
<canvas id="game" style="width: 100vw; height: 100vh; display: block"></canvas>
```

The engine pins a fixed pixel size onto a canvas that carries no inline size of
its own, so the inline rule is what keeps the element free to follow the window.
A canvas that fills a sized wrapper takes the same form, with `width: 100%;
height: 100%` inline on the canvas.

The engine reads the laid-out size at the top of every frame and resizes the
backing store to match the device pixel ratio, so a window resize needs no
handler and no code in the game.

## Tearing down

A game that runs for the life of the page never needs to stop. When a build
mounts the game into a view that goes away, `engine.destroy()` stops the loop
and removes every listener the engine installed.

```ts
engine.destroy();
```
