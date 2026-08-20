---
title: A Minimal Game
---

The smallest complete build: a page holding a canvas, a boot module, and a game
that slides a rectangle across the field and reflects it off both walls. It
registers no action, loads no asset, and defines no cue, so what remains is the
whole of what a build must supply.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Drifter</title>
  </head>
  <body style="margin: 0; background: #05060a">
    <canvas
      id="game"
      style="display: block; width: 100vw; height: 100vh"
    ></canvas>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

The canvas carries its size inline, so the engine leaves the element free to
follow the window and fits the logical field into whatever size it reports.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/simple-2d";
import { drifter } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: drifter,
});

await engine.initialize();
await engine.run();
```

`createEngine` runs no game code, `initialize` runs the game's `initialize` and
builds the state, and `run` drives frames off the host's frame callback until
the engine is destroyed. Omitting the clock installs a
[`WallClock`](/engines/simple-2d/apis/clocks/), so each frame is worth the time
that actually elapsed.

## src/game.ts

```ts
import type { Game, RenderApi, UpdateApi } from "@test-cabinet/simple-2d";

const BOX = 48;
const SPEED = 220;

interface State {
  x: number;
  y: number;
  vx: number;
}

export const drifter: Game<State> = {
  initialize(): State {
    return { x: 0, y: 156, vx: SPEED };
  },

  update(state: State, api: UpdateApi, dt: number): void {
    const limit = api.viewport().width - BOX;
    state.x += state.vx * dt;

    if (state.x < 0) {
      state.x = -state.x;
      state.vx = SPEED;
    } else if (state.x > limit) {
      state.x = 2 * limit - state.x;
      state.vx = -SPEED;
    }
  },

  render(state: State, api: RenderApi): void {
    const { ctx } = api;
    ctx.fillStyle = "#7fd1ff";
    ctx.fillRect(state.x, state.y, BOX, BOX);
  },
};
```

## What the game owns

`State` is the whole of what the three functions share, and `initialize` returns
it complete, so `update` and `render` read every field directly.

`update` multiplies by `dt` in seconds and reflects the overshoot back into the
field, which keeps the outcome the same whatever step size the clock delivers.
Reading the bound from `api.viewport()` keeps the design width in one place, the
`width` passed to `createEngine`.

`render` draws in logical units against a context that arrives cleared and
already carrying the viewport transform, so the rectangle lands in the same
place on every display.
