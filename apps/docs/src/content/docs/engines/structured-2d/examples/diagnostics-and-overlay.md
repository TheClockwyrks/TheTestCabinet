---
title: Diagnostics and Overlay
---

A build named Patrol that names the values a reviewer would otherwise read off
the pixels. Two of them belong to the whole game and are registered by the game
instance; four belong to one match and are registered by the game mode. Both
registries are readable while the game runs, on the overlay and from outside the
page.

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/structured-2d";
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
import { GameInstance } from "@test-cabinet/structured-2d";
import type { InitApi } from "@test-cabinet/structured-2d";

const BUILD = "patrol 1.4.0";

export class PatrolInstance extends GameInstance {
  opens = 0;

  override initialize(api: InitApi): void {
    api.diagnostics.register("build", () => BUILD);
    api.diagnostics.register("opens", () => this.opens);
  }

  override worldOpened(): void {
    this.opens += 1;
  }
}
```

`initialize` runs once, before the start level opens, and a source registered
from `InitApi` belongs to the whole game. `build` and `opens` therefore survive
every transition, and `opens` counts them because `worldOpened` runs after each
world's game mode has begun play.

## src/game.ts

```ts
import { Actor, ShapeComponent } from "@test-cabinet/structured-2d";
import type { GameDefinition } from "@test-cabinet/structured-2d";
import { PatrolInstance } from "./instance";
import { PatrolMode, TAG } from "./levels/patrol-mode";

const drones = Array.from({ length: 6 }, (_, i) => ({
  type: Actor,
  transform: { x: 40 + i * 96, y: 120 + (i % 3) * 60 },
  tags: [TAG],
  configure: (actor: Actor) => {
    actor.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: 24, height: 12 },
        fill: "#7fd1ff",
      }),
    );
  },
}));

export const patrol: GameDefinition = {
  instance: PatrolInstance,
  levels: { patrol: { mode: PatrolMode, actors: drones } },
  startLevel: "patrol",
};
```

## src/levels/patrol-mode.ts

```ts
import { GameMode } from "@test-cabinet/structured-2d";

export const TAG = "drone";

export class PatrolMode extends GameMode {
  private wave = 1;
  private pace = 61.75;

  override beginPlay(): void {
    const diagnostics = this.world.diagnostics;
    diagnostics.register("wave", () => this.wave);
    diagnostics.register("drones", () => this.world.byTag(TAG).length);
    diagnostics.register("lead", () => {
      const lead = this.world.byTag(TAG)[0];
      return lead === undefined
        ? null
        : { x: lead.transform.x, y: lead.transform.y };
    });
    diagnostics.register("pace", () => this.pace);

    this.world.every(6, () => {
      this.wave += 1;
      this.pace += 6.5;
    });
    this.setPhase("playing");
  }

  override tick(dt: number): void {
    for (const drone of this.world.byTag(TAG)) {
      drone.transform.x = (drone.transform.x + this.pace * dt) % 640;
    }
  }
}
```

A source registered from `world.diagnostics` lives as long as the world, so
these four are dropped when the world closes while the instance's two persist.
Each one closes over the object that holds the value rather than over a copy,
and the engine evaluates every source on each read, so a line reports what the
game holds at that instant.

## What the overlay draws

The overlay is hidden when the engine is created and is toggled by the
`Backquote` key, which is engine chrome rather than a registered action. It
draws the engine's own world line first, then the instance's sources, then the
world's, then a metrics line, then the frame-time graph.

```text
level: patrol  phase: playing  actors: 6
build: patrol 1.4.0
opens: 1
wave: 3
drones: 6
lead: {"x":217.375,"y":120}
pace: 74.750
frame: 3.417 / 5.208 / 6.125 ms
```

The four shapes the sources return cover the formatting rules. A string prints
as itself, an integer prints whole, a non-integer prints to three decimal
places, and an object prints as JSON. The metrics line reads the mean, the 95th,
and the 99th percentile of the wall time spent in the frame's ticks, its
collision pass, its render, and the overlay, over a window of the last 10
seconds of simulated time. The percentiles are nearest-rank.

## Reading the same values from a console

The engine publishes the [host handle](/engines/structured-2d/apis/host/) at
construction, and its `diagnostics` evaluates every registered source at the
moment of the call, instance sources first and world sources after them.

```js
window.__tcabEngine.diagnostics();
// { build: "patrol 1.4.0", opens: 1, wave: 3, drones: 6,
//   lead: { x: 217.375, y: 120 }, pace: 74.75 }

window.__tcabEngine.world();
// { level: "patrol", phase: "playing", time: 12.5, actors: 6, players: [] }
```

Every value crosses as plain data: `diagnostics` reduces each source through a
JSON round trip, and `world` reports counts and names rather than the live
objects. A source that throws contributes its error message as a string, and the
read itself never throws.

The read is independent of whether the overlay is drawn, so a post-run check and
a devtools console both see the values while the panel is hidden. `setOverlay`
brings the panel up without touching the toggle key.

```js
window.__tcabEngine.setOverlay(true);
```
