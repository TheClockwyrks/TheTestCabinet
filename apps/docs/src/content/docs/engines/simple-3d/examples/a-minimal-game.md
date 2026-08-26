---
title: A Minimal Game
---

The smallest complete build: a page holding a canvas, a boot module, and a game
that slides a box along a floor and reflects it at both ends of its track. It
registers no action, loads no asset, and defines no cue, so what remains is the
whole of what a build must supply.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Glider</title>
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
import { glider } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: glider,
});

await engine.initialize();
await engine.run();
```

`createEngine` runs no game code, `initialize` runs the game's `initialize` and
builds the state, and `run` drives frames off the host's frame callback until
the engine is destroyed. Omitting the clock installs a
[`WallClock`](/engines/simple-3d/apis/clocks/), so each frame is worth the time
that actually elapsed.

## src/game.ts

```ts
import { quatFromAxisAngle } from "@test-cabinet/simple-3d";
import type {
  CameraState,
  Game,
  LightState,
  Quat,
  RenderApi,
  Transform,
  UpdateApi,
  Vec3,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const LIMIT = 6;
const SPEED = 4;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 5, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.3),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 0.35 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 0.9,
    direction: { x: -0.5, y: -1, z: -0.5 },
  },
];

interface State {
  readonly x: number;
  readonly vx: number;
}

function at(x: number, y: number, z: number): Transform {
  return { position: { x, y, z }, rotation: IDENTITY, scale: ONE };
}

export const glider: Game<State, null> = {
  initialize(): [State, null] {
    return [{ x: -LIMIT, vx: SPEED }, null];
  },

  update(state: DeepReadonly<State>, _api: UpdateApi, dt: number): State {
    const x = state.x + state.vx * dt;

    if (x < -LIMIT) return { x: -2 * LIMIT - x, vx: SPEED };
    if (x > LIMIT) return { x: 2 * LIMIT - x, vx: -SPEED };
    return { ...state, x };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    scene.drawGeometry(scene.createPlane(16, 8), "#182231", at(0, 0, 0));
    scene.drawGeometry(
      scene.createBox({ x: 1, y: 1, z: 1 }),
      "#7fd1ff",
      at(state.x, 0.5, 0),
    );
  },
};
```

## What the game owns

`State` is the whole of what the three functions share, and `initialize` returns
it complete, so `update` and `render` read every field directly. Both receive
it as a `DeepReadonly` view; `update` returns the next value and `render`
returns nothing, so `ts-essentials` is the one import beside the engine.

`update` multiplies by `dt` in seconds and reflects the overshoot back into the
track, which keeps the outcome the same whatever step size the clock delivers.
The bound is a world-unit constant of the game's own, because a world unit means
whatever the game decides; the `width` handed to `createEngine` sizes the
logical field the picture is projected into, not the world.

`render` draws the complete picture every frame against a scene that arrives
cleared. `setCamera` and `setLights` are retained renderer state, so setting
them once would hold, but re-applying the same plain values each frame keeps the
game's own state the source of truth and costs nothing. Passing a color as the
material draws a standard lit surface in that base color.

The two `create*` calls run every frame as well. A produced geometry is a
resource keyed on the call that made it, so identical arguments share one entry
in a [recording](/engines/simple-3d/apis/recording/) and per-frame creation is
the idiomatic pattern. With the frustum's aspect fixed to the design aspect, the
box lands in the same place in the letterboxed picture on every display.
