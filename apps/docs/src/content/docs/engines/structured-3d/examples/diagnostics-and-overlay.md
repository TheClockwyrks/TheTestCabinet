---
title: Diagnostics and Overlay
---

A build named Patrol that names the values a reviewer would otherwise read off
the pixels. Two of them belong to the whole game and are registered by the game
instance; four belong to one match and are registered by the game mode. Both
registries are drawn on the overlay while the game runs.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-3d";
import { patrol } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: patrol,
});

await engine.initialize();
await engine.run();
```

The boot module registers nothing. Sources belong to the objects that own the
values, so each line stays in step with what produces it.

## src/instance.ts

```ts
import { GameInstance } from "@test-cabinet/structured-3d";
import type { InitApi } from "@test-cabinet/structured-3d";

const BUILD = "patrol 1.4.0";

export class PatrolInstance extends GameInstance<null> {
  opens = 0;

  override initialize(api: InitApi): null {
    api.diagnostics.register("build", () => BUILD);
    api.diagnostics.register("opens", () => this.opens);
    return null;
  }

  override worldOpened(): void {
    this.opens += 1;
  }
}
```

`initialize` runs once, before the start level opens, and a source registered
from `InitApi` belongs to the whole game. Patrol offers no debug surface, so
`initialize` returns `null`. `build` and `opens` therefore survive
every transition, and `opens` counts them because `worldOpened` runs after each
world's game mode has begun play.

## src/game.ts

```ts
import { Actor, ShapeComponent } from "@test-cabinet/structured-3d";
import type { GameDefinition } from "@test-cabinet/structured-3d";
import { PatrolInstance } from "./instance";
import { PatrolMode, TAG } from "./levels/patrol-mode";

const drones = Array.from({ length: 6 }, (_, i) => ({
  type: Actor,
  transform: {
    position: { x: -10 + i * 4, y: 1 + (i % 3) * 1.5, z: -(i % 2) * 3 },
  },
  tags: [TAG],
  configure: (actor: Actor) => {
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 1.6, y: 0.4, z: 0.8 } },
        color: "#7fd1ff",
      }),
    );
  },
}));

export const patrol: GameDefinition<null> = {
  instance: PatrolInstance,
  levels: { patrol: { mode: PatrolMode, actors: drones } },
  startLevel: "patrol",
};
```

## src/levels/patrol-mode.ts

```ts
import { GameMode } from "@test-cabinet/structured-3d";

export const TAG = "drone";
const EDGE = 12;

export class PatrolMode extends GameMode {
  private wave = 1;
  private pace = 3.125;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 6, z: 18 };
    this.world.camera.lookAt({ x: 0, y: 2, z: 0 });

    const diagnostics = this.world.diagnostics;
    diagnostics.register("wave", () => this.wave);
    diagnostics.register("drones", () => this.world.byTag(TAG).length);
    diagnostics.register("lead", () => {
      const lead = this.world.byTag(TAG)[0];
      return lead === undefined ? null : { ...lead.transform.position };
    });
    diagnostics.register("pace", () => this.pace);

    this.world.every(6, () => {
      this.wave += 1;
      this.pace += 0.375;
    });
    this.setPhase("playing");
  }

  override tick(dt: number): void {
    for (const drone of this.world.byTag(TAG)) {
      const position = drone.transform.position;
      position.x += this.pace * dt;
      if (position.x > EDGE) position.x -= 2 * EDGE;
    }
  }
}
```

A source registered from `world.diagnostics` lives as long as the world, so
these four are dropped when the world closes while the instance's two persist.
Each one closes over the object that holds the value rather than over a copy,
and the engine evaluates every source on each read, so a line reports what the
game holds at that instant. `lead` copies the position it reports, which keeps
the reading plain data rather than a live transform.

## What the overlay draws

The overlay is hidden when the engine is created and is toggled by the
`Backquote` key, which is engine chrome rather than a registered action. It
draws on the engine's own 2D overlay surface, composited above the rendering
canvas, so nothing of it enters the 3D picture or a recording. It draws the
engine's own world line first, then the instance's sources, then the world's,
then a metrics line, then the frame-time graph.

```text
level: patrol  phase: playing  actors: 6
build: patrol 1.4.0
opens: 1
wave: 3
drones: 6
lead: {"x":-3.625,"y":1,"z":0}
pace: 3.875
frame: 3.417 / 5.208 / 6.125 ms
```

The four shapes the sources return cover the formatting rules. A string prints
as itself, an integer prints whole, a non-integer prints to three decimal
places, and an object prints as JSON. The metrics line reads the mean, the 95th,
and the 99th percentile of the wall time spent in the frame's ticks, its
collision pass, its render, and the overlay, over a window of the last 10
seconds of simulated time. The percentiles are nearest-rank.
