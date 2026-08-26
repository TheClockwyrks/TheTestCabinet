---
title: A Minimal Game
---

The smallest complete build: a page with a canvas, a boot module, a game
definition with one level, one actor that drifts a spinning box between two
bounds, and the mode that level runs under. It registers no action and loads no
asset.

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
    <canvas id="game" style="display: block; width: 100vw; height: 100vh"></canvas>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

The canvas carries its size inline, so the engine fits the logical field into
whatever size the element reports.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
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

`initialize` builds the game instance, opens the start level, and resolves once
its actors and its mode have begun play. `run` drives frames off the host's
callback, on the [`WallClock`](/engines/structured-3d/apis/clocks/) by default.

## src/game.ts

```ts
import type { GameDefinition } from "@test-cabinet/structured-3d";
import { Drifter } from "./actors/drifter";
import { DriftMode } from "./levels/drift-mode";

export const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [{ type: Drifter }],
    },
  },
  startLevel: "drift",
};
```

The definition names no instance class, so the engine builds a plain
`GameInstance`. The level declares its one actor and the mode it runs under. The
actor's spec names no transform, so it begins at the identity, at the world
origin.

## src/actors/drifter.ts

```ts
import {
  Actor,
  ShapeComponent,
  quatFromAxisAngle,
  quatMultiply,
} from "@test-cabinet/structured-3d";

const SIZE = 1.5;
const SPEED = 4;
const LIMIT = 8;
const TURN = Math.PI / 2;
const UP = { x: 0, y: 1, z: 0 };

export class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: SIZE, y: SIZE, z: SIZE } },
        color: "#7fd1ff",
      }),
    );
  }

  override tick(dt: number): void {
    const p = this.transform.position;
    p.x += this.vx * dt;

    if (p.x < -LIMIT) {
      p.x = -2 * LIMIT - p.x;
      this.vx = SPEED;
    } else if (p.x > LIMIT) {
      p.x = 2 * LIMIT - p.x;
      this.vx = -SPEED;
    }

    this.transform.rotation = quatMultiply(
      quatFromAxisAngle(UP, TURN * dt),
      this.transform.rotation,
    );
  }
}
```

## src/levels/drift-mode.ts

```ts
import { GameMode } from "@test-cabinet/structured-3d";

export class DriftMode extends GameMode {}
```

## What the game owns

The build supplies two classes and one object; the engine owns the frame, the
camera, the viewport, and the picture. The base game mode's `beginPlay`, `tick`,
and `endPlay` do nothing, so `DriftMode` overrides nothing. `Drifter`'s
constructor attaches the component that draws it and sets the velocity, which is
everything the actor settles before it belongs to a world.

`tick` multiplies by `dt` in seconds and reflects the overshoot back inside the
bound, which keeps the outcome the same whatever step size the clock delivers.
The spin works the same way: each frame composes a yaw increment of `TURN * dt`
radians onto the held rotation with `quatMultiply`, so the orientation is a
function of accumulated time rather than of the frame count. The bound is the
game's own rule, stated in world units: world units mean whatever the game
decides, and nothing about the logical field's size enters the movement.

The world's camera starts at its defaults, at `(0, 0, 10)` looking down −Z, so
the origin the actor drifts through is the center of the picture, and the world
holds no light component, so the engine's default rig lights the box. Drawing
belongs to the `ShapeComponent`, which the pipeline draws each frame through the
camera's frustum.
