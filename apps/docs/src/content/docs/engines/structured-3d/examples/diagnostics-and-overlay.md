---
title: Diagnostics and Overlay
---

A build named Patrol that names the values a reviewer would otherwise read off
the pixels. Two of them belong to the whole game and are registered by the game
instance; four belong to one match and are registered by the game mode. Both
registries are drawn on the overlay while the game runs, beside the engine's own
frame metrics.

## src/main.ts

```ts
import { createEngine } from "@clockwyrks/structured-3d";
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
import { GameInstance } from "@clockwyrks/structured-3d";
import type { InitApi } from "@clockwyrks/structured-3d";

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
import {
  Actor,
  LightComponent,
  MeshComponent,
  quatLookAt,
  vec3,
} from "@clockwyrks/structured-3d";
import type { GameDefinition } from "@clockwyrks/structured-3d";
import { PatrolInstance } from "./instance";
import { PatrolMode, TAG } from "./levels/patrol-mode";

const lights = {
  type: Actor,
  transform: { rotation: quatLookAt(vec3(-0.4, -1, -0.6)) },
  configure: (actor: Actor) => {
    actor.attach(new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }));
    actor.attach(new LightComponent({ light: { kind: "directional", intensity: 2 } }));
  },
};

const drones = Array.from({ length: 6 }, (_, i) => ({
  type: Actor,
  transform: { position: vec3(-6 + i * 2.4, (i % 3) * 1.2 - 1.2, 0) },
  tags: [TAG],
  configure: (actor: Actor) => {
    actor.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 0.6, height: 0.3, depth: 0.3 },
        material: { color: "#7fd1ff" },
      }),
    );
  },
}));

export const patrol: GameDefinition<null> = {
  instance: PatrolInstance,
  levels: { patrol: { mode: PatrolMode, actors: [lights, ...drones] } },
  startLevel: "patrol",
};
```

The drones sit on the `z = 0` plane in front of the camera's default pose, at
`(0, 0, 10)` looking along `-Z`, and the lights actor gives the directional light
a rotation that shines it down and into the field. A `MeshComponent` under the
`standard` material takes its shading from those lights, which is what the
`shaded` render mode draws.

## src/levels/patrol-mode.ts

```ts
import { GameMode, vec3 } from "@clockwyrks/structured-3d";

export const TAG = "drone";
const HALF_WIDTH = 8;

export class PatrolMode extends GameMode {
  private wave = 1;
  private pace = 1.55;

  override beginPlay(): void {
    const diagnostics = this.world.diagnostics;
    diagnostics.register("wave", () => this.wave);
    diagnostics.register("drones", () => this.world.byTag(TAG).length);
    diagnostics.register("lead", () => {
      const lead = this.world.byTag(TAG)[0];
      if (lead === undefined) return "none";
      const { x, y, z } = lead.transform.position;
      return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    });
    diagnostics.register("pace", () => this.pace);

    this.world.every(6, () => {
      this.wave += 1;
      this.pace += 0.25;
    });
    this.setPhase("playing");
  }

  override tick(dt: number): void {
    for (const drone of this.world.byTag(TAG)) {
      const { position } = drone.transform;
      const x = position.x + this.pace * dt;
      drone.transform.position = vec3(
        x > HALF_WIDTH ? x - 2 * HALF_WIDTH : x,
        position.y,
        position.z,
      );
    }
  }
}
```

A source registered from `world.diagnostics` lives as long as the world, so
these four are dropped when the world closes while the instance's two persist.
Each one closes over the object that holds the value rather than over a copy,
and the engine evaluates every source on each read, so a line reports what the
game holds at that instant. `lead` reduces a `Vec3` to a string inside the
source, because a source reports a string, a number, or a boolean.

## What the overlay draws

The overlay is hidden when the engine is created and is toggled by the
`Backquote` key, which is engine chrome rather than a registered action. It
draws the engine's own world line first, then the instance's sources, then the
world's, then a metrics line, then the frame-time graph. It is drawn on the
screen layer in device space, after the recorder has captured the frame, so it
appears on the canvas and outside every recording.

```text
level: patrol  phase: playing  actors: 7
build: patrol 1.4.0
opens: 1
wave: 3
drones: 6
lead: -2.3, 0.0, 0.0
pace: 2.050
frame: 3.417 / 5.208 / 6.125 ms · 6 draws · 72 tris
```

The shapes the sources return cover the formatting rules. A string prints as
itself, an integer prints whole, and a non-integer prints to three decimal
places. `lead` formats the position inside the source, since a source reports a
string, a number, or a boolean. The world line counts seven actors: the six
drones and the actor carrying the lights.

The metrics line reads the mean, the 95th, and the 99th percentile of the wall
time spent in the frame's ticks, its collision pass, its render, and the
overlay, over a window of the last 10 seconds of simulated time. The percentiles
are nearest-rank. After the timings come the draw calls and the triangles the
renderer issued for the most recent frame, read from the renderer after the
scene was rendered: six boxes are six draws of twelve triangles each, and a
light is no draw.

## Reading the values back

A check reads the same values by holding the engine rather than the page, so it
asserts what Patrol registered rather than what the panel drew.

```ts
const readings = engine.diagnostics();

expect(readings.map((r) => r.name)).toEqual([
  "build",
  "opens",
  "wave",
  "drones",
  "lead",
  "pace",
]);
expect(readings[0]).toEqual({ name: "build", value: "patrol 1.4.0" });
expect(readings[3]).toEqual({ name: "drones", value: 6 });
```

The instance's two sources come first and the world's four follow, each in
registration order, which is the order the panel draws them in. Reading changes
nothing the engine holds, and the overlay stays hidden throughout.
