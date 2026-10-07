---
title: A Minimal Game
---

The smallest complete build: a page with a canvas, a boot module, a game
definition with one level, a lamp that lights the scene, one actor that carries
a box back and forth between two bounds, a readout that reports where the box
is, and the mode that level runs under. It registers no action and loads no
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
    <canvas
      id="game"
      style="display: block; width: 100vw; height: 100vh"
    ></canvas>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

The canvas carries its size inline, so the engine fits the logical field into
whatever size the element reports.

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-3d";
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
import type { GameDefinition } from "@clockwyrks/structured-3d";
import { Drifter } from "./actors/drifter";
import { Lamp } from "./actors/lamp";
import { Readout } from "./actors/readout";
import { DriftMode } from "./levels/drift-mode";

export const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [
        { type: Lamp },
        { type: Drifter },
        { type: Readout, transform: { position: { x: 320, y: 24, z: 0 } } },
      ],
    },
  },
  startLevel: "drift",
};
```

The definition names no instance class, so the engine builds a plain
`GameInstance`. The level declares its three actors and the mode it runs under.
The lamp and the drifter sit at the identity transform, which is the world
origin, and the readout's transform is a screen-space placement in logical
units.

## src/actors/lamp.ts

```ts
import {
  Actor,
  LightComponent,
  quatFromEuler,
} from "@clockwyrks/structured-3d";

export class Lamp extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    const sun = this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    );
    sun.offset.rotation = quatFromEuler(-Math.PI / 4, Math.PI / 4, 0);
  }
}
```

A directional light shines along its component's world forward axis, so the
offset's rotation is what aims it: a pitch of a quarter turn down and a yaw of
a quarter turn to the side lights the box from above and to one side. The
hemisphere light fills the faces the sun leaves in shadow.

## src/actors/drifter.ts

```ts
import { Actor, MeshComponent, vec3 } from "@clockwyrks/structured-3d";

const BOX = 1;
const SPEED = 6;
const LIMIT = 8;

export class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: BOX, height: BOX, depth: BOX },
        material: { color: "#7fd1ff", roughness: 0.6 },
      }),
    );
  }

  override tick(dt: number): void {
    const half = BOX / 2;
    const limit = LIMIT - half;
    const current = this.transform.position;
    let x = current.x + this.vx * dt;

    if (x < -limit) {
      x = -2 * limit - x;
      this.vx = SPEED;
    } else if (x > limit) {
      x = 2 * limit - x;
      this.vx = -SPEED;
    }
    this.transform.position = vec3(x, current.y, current.z);
  }
}
```

## src/actors/readout.ts

```ts
import { Actor, TextComponent } from "@clockwyrks/structured-3d";
import { Drifter } from "./drifter";

export class Readout extends Actor {
  readonly label = this.attach(
    new TextComponent({ text: "", font: "20px monospace", fill: "#e6edf6" }),
  );
  private drifter: Drifter | null = null;

  override beginPlay(): void {
    this.drifter = this.world.find(Drifter);
  }

  override tick(): void {
    if (this.drifter === null) return;
    this.label.text = `x ${this.drifter.transform.position.x.toFixed(2)}`;
  }
}
```

## src/levels/drift-mode.ts

```ts
import { GameMode } from "@clockwyrks/structured-3d";

export class DriftMode extends GameMode {}
```

## What the game owns

The build supplies four classes and one object; the engine owns the frame, the
camera, the viewport, the lighting model, and the picture. The base game mode's
`beginPlay`, `tick`, and `endPlay` do nothing, so `DriftMode` overrides
nothing. Each actor's constructor attaches the components that draw it and sets
its defaults, which is everything an actor settles before it belongs to a
world.

`tick` multiplies by `dt` in seconds and reflects the overshoot back into the
lane, which keeps the outcome the same whatever step size the clock delivers.
The transform is a plain record, so the move is an assignment of a fresh vector
built with `vec3`. The world's camera starts at `(0, 0, 10)` looking along `-Z`
at the origin with a vertical field of view of `60` degrees, so at the `z = 0`
plane it sees about `5.8` units up and down and `10.3` units left and right,
and a bound of `8` keeps the box in view at both ends. A box is centered on its
component's transform, so the bounds sit half a box in from each limit. Drawing
belongs to the `MeshComponent`, which the pipeline places at the actor's world
transform each frame and renders through the camera, and a `standard` material
takes its shading from the lamp's lights.

The readout is a screen-space component, so its actor's position is logical
units from the top-left of the design field and the camera plays no part in
where it draws. Every actor a level declares exists before any of their
`beginPlay` runs, so the readout finds the drifter there with `world.find`.
Actors tick in spawn order and the readout is declared after the drifter, so
the text it writes is the position this frame's tick produced.
