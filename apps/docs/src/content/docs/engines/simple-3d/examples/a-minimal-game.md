---
title: A Minimal Game
---

The smallest complete build: a page holding a canvas, a boot module, and a game
that slides a cube across the world and reflects it at both ends of its run,
with its position written on the screen layer. It registers no action, loads no
asset, and defines no cue, so what remains is the whole of what a build must
supply.

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
import { createEngine } from "@test-cabinet/simple-3d";
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
[`WallClock`](/engines/simple-3d/apis/clocks/), so each frame is worth the time
that actually elapsed. Omitting `backend` and `projection` gives the build a
`webgl` renderer over the canvas and a perspective camera at the
[camera defaults](/engines/simple-3d/apis/view/).

## src/game.ts

```ts
import * as THREE from "three";
import type { Game, InitApi, RenderApi, UpdateApi } from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const LIMIT = 8;
const SPEED = 4;

interface State {
  readonly x: number;
  readonly vx: number;
}

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
);
cube.name = "drifter";

export const drifter: Game<State, null> = {
  initialize(api: InitApi<State>): [State, null] {
    api.scene.add(new THREE.HemisphereLight("#ffffff", "#223344", 1));
    api.scene.add(cube);
    return [{ x: -LIMIT, vx: SPEED }, null];
  },

  update(state: DeepReadonly<State>, _api: UpdateApi, dt: number): State {
    const x = state.x + state.vx * dt;

    if (x < -LIMIT) return { x: -2 * LIMIT - x, vx: SPEED };
    if (x > LIMIT) return { x: 2 * LIMIT - x, vx: -SPEED };
    return { ...state, x };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    cube.position.x = state.x;

    const { screen } = api;
    screen.fillStyle = "#e6edf6";
    screen.font = "16px monospace";
    screen.fillText(`x ${state.x.toFixed(2)}`, 16, 28);
  },
};
```

## What the game owns

`State` is the whole of what the three functions share, and `initialize` returns
it complete, so `update` and `render` read every field directly. Both receive
it as a `DeepReadonly` view; `update` returns the next value and `render`
returns nothing, so `ts-essentials` is the one import beside the engine and
`three`. The state carries the cube's position and velocity alone. The cube
itself is a three object, mutated in place, so it lives at module level on the
render side and the state never names it.

`initialize` adds the light and the cube to
[`api.scene`](/engines/simple-3d/apis/game/), the engine's retained scene, and
both are still there when every later `render` runs. The camera is left at its
defaults, at `(0, 0, 10)` looking along `-Z` with a vertical field of view of
60 degrees, so the `z = 0` plane the cube moves on shows about 11.5 world units
top to bottom and 20.5 across at the design aspect, and a run of `-8..8` keeps
the cube in view.

`update` multiplies by `dt` in seconds and reflects the overshoot back into the
run, which keeps the outcome the same whatever step size the clock delivers.
Each branch spreads the current state into a new one, and the engine keeps the
value returned as the state the next frame receives.

`render` writes the cube's position from the state and draws the readout on
the screen layer in logical units,
against a context that arrives cleared and already carrying the viewport
transform, so the text lands in the same place on every display. The engine
renders the scene through the camera after `render` returns and composites the
screen layer over the picture.
