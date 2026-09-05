---
title: A Minimal Game
---

The smallest complete build: a page with a canvas, a boot module, a game
definition with one level, one actor that reflects a rectangle off both walls,
and the mode that level runs under. It registers no action and loads no asset.

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
import { createEngine } from "@clockwyrks/structured-2d";
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
callback, on the [`WallClock`](/engines/structured-2d/apis/clocks/) by default.

## src/game.ts

```ts
import type { GameDefinition } from "@clockwyrks/structured-2d";
import { Drifter } from "./actors/drifter";
import { DriftMode } from "./levels/drift-mode";

export const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [{ type: Drifter, transform: { x: 320, y: 180 } }],
    },
  },
  startLevel: "drift",
};
```

The definition names no instance class, so the engine builds a plain
`GameInstance`. The level declares its one actor and the mode it runs under.

## src/actors/drifter.ts

```ts
import { Actor, ShapeComponent } from "@clockwyrks/structured-2d";

const BOX = 48;
const SPEED = 220;

export class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: BOX, height: BOX },
        fill: "#7fd1ff",
      }),
    );
  }

  override tick(dt: number): void {
    const half = BOX / 2;
    const limit = this.world.viewport().width - half;
    this.transform.x += this.vx * dt;

    if (this.transform.x < half) {
      this.transform.x = 2 * half - this.transform.x;
      this.vx = SPEED;
    } else if (this.transform.x > limit) {
      this.transform.x = 2 * limit - this.transform.x;
      this.vx = -SPEED;
    }
  }
}
```

## src/levels/drift-mode.ts

```ts
import { GameMode } from "@clockwyrks/structured-2d";

export class DriftMode extends GameMode {}
```

## What the game owns

The build supplies two classes and one object; the engine owns the frame, the
camera, the viewport, and the picture. The base game mode's `beginPlay`, `tick`,
and `endPlay` do nothing, so `DriftMode` overrides nothing. `Drifter`'s
constructor attaches the component that draws it and sets the velocity, which is
everything the actor settles before it belongs to a world.

`tick` multiplies by `dt` in seconds and reflects the overshoot back into the
field, which keeps the outcome the same whatever step size the clock delivers.
The world's camera starts at the center of the design field at zoom `1`, so
world coordinates and logical coordinates coincide and `world.viewport().width`
is the design width the bound is measured from. A rect is centered on its
component's transform, so the bounds sit half a box in from each wall. Drawing
belongs to the `ShapeComponent`, which the pipeline draws each frame under the
world-to-device transform.
