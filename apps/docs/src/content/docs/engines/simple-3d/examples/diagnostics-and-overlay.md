---
title: Diagnostics and Overlay
---

A build that names the values a reviewer would otherwise read off the pixels: a
phase, a score, a position, a derived speed, and a frame rate. Each is
registered once during initialization as a function over the state, and the same
values are readable from outside the page while the game runs.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rally</title>
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

## src/main.ts

```ts
import { createEngine } from "@test-cabinet/simple-3d";
import { rally } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: rally,
});

await engine.initialize();
await engine.run();
```

The boot module registers nothing. Sources belong to the game, so the values on
the overlay stay in step with the state that produces them.

## src/game.ts

```ts
import * as THREE from "three";
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const BALL = 0.4;
const SPEED = 6;
const HALF_WIDTH = 8;
const HALF_DEPTH = 5;

interface Ball {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

export interface RallyState {
  readonly phase: "serve" | "rally";
  readonly serveIn: number;
  readonly ball: Ball;
  readonly score: { readonly left: number; readonly right: number };
  readonly fps: number;
}

function serve(state: DeepReadonly<RallyState>, vx: number): RallyState {
  return {
    ...state,
    phase: "serve",
    serveIn: 1,
    ball: { x: 0, z: 0, vx, vz: SPEED / 2 },
  };
}

export const rally: Game<RallyState, null> = {
  initialize(api: InitApi<RallyState>): [RallyState, null] {
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("score", (s) => `${s.score.left} - ${s.score.right}`);
    api.diagnostics.register(
      "ball",
      (s) => `${s.ball.x.toFixed(1)}, ${s.ball.z.toFixed(1)}`,
    );
    api.diagnostics.register("speed", (s) => Math.hypot(s.ball.vx, s.ball.vz));
    api.diagnostics.register("fps", (s) => s.fps);

    return [
      {
        phase: "serve",
        serveIn: 1,
        ball: { x: 0, z: 0, vx: SPEED, vz: SPEED / 2 },
        score: { left: 0, right: 0 },
        fps: 0,
      },
      null,
    ];
  },

  update(state: DeepReadonly<RallyState>, api: UpdateApi, dt: number): RallyState {
    const fps = Math.round(1000 / Math.max(api.frame().lastDeltaMs, 1));

    if (state.phase === "serve") {
      const serveIn = state.serveIn - dt;
      if (serveIn > 0) return { ...state, fps, serveIn };
    }

    const x = state.ball.x + state.ball.vx * dt;
    const z = state.ball.z + state.ball.vz * dt;
    const vz =
      z < -HALF_DEPTH + BALL || z > HALF_DEPTH - BALL
        ? -state.ball.vz
        : state.ball.vz;
    const moved: RallyState = {
      ...state,
      phase: "rally",
      fps,
      ball: { ...state.ball, x, z, vz },
    };

    if (x < -HALF_WIDTH + BALL) {
      const score = { ...moved.score, right: moved.score.right + 1 };
      return serve({ ...moved, score }, SPEED);
    }
    if (x > HALF_WIDTH - BALL) {
      const score = { ...moved.score, left: moved.score.left + 1 };
      return serve({ ...moved, score }, -SPEED);
    }
    return moved;
  },

  render(state: DeepReadonly<RallyState>, api: RenderApi): void {
    let ball = api.scene.getObjectByName("ball");
    if (ball === undefined) {
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(BALL, 24, 16),
        new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
      );
      ball.name = "ball";
      api.scene.add(ball);
      api.scene.add(new THREE.HemisphereLight("#ffffff", "#20242e", 2));
    }
    ball.position.set(state.ball.x, BALL, state.ball.z);

    api.camera.position.set(0, 12, 12);
    api.camera.lookAt(0, 0, 0);
  },
};
```

## Sources over the state

Each source takes the state and reads off it. The engine evaluates the sources
on each read, handing each one the state current at that moment, so a line
reports what the game holds at that instant rather than the opening value
`initialize` returned. `InitApi<RallyState>` is what types the argument.

The five sources cover the shapes the overlay formats. A string prints as
itself, an integer prints whole, and a non-integer prints to three decimal
places. A source reports a string, a number, or a boolean, so the position is
formatted inside the source rather than handed over as a pair.

`fps` comes from the frame counter, so `update` carries it in the state it
returns and the source reads the field. `api.frame()` belongs to the frame the
counter describes, and the source runs after that frame's render.

The sources read the state alone. The ball's mesh is a three object in the
retained scene, built on the first render and found by name on every later one,
and the position the overlay reports is the one the state carries rather than
one read off the mesh, so the overlay describes the simulation whatever the
picture is doing.

## Reading the values back

The overlay is what a person reads the sources off. The backtick key brings it
up, so this build binds no key of its own and leaves that key free of gameplay
bindings. Beneath the registered lines the overlay prints the engine's own
metrics line, the frame timings followed by the most recent frame's draw calls
and triangles, which come from the renderer.

A check reads the same values by holding the engine rather than the page. It
constructs the engine over this build's `rally` module, steps it with
`engine.advance`, and reads `engine.diagnostics()`, which returns one reading
per source in registration order.

```ts
await engine.advance(60);

const readings = engine.diagnostics();

expect(readings.map((r) => r.name)).toEqual([
  "phase",
  "score",
  "ball",
  "speed",
  "fps",
]);
expect(readings[0]).toEqual({ name: "phase", value: "rally" });
expect(readings[1]).toEqual({ name: "score", value: "0 - 0" });
```

That asserts what the build registered, which is the build's whole part in the
overlay. Drawing the panel on the screen layer and toggling it belong to the
engine.
