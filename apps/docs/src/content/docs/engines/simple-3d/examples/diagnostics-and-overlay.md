---
title: Diagnostics and Overlay
---

A build that names the values a reviewer would otherwise read off the pixels: a
phase, a bounce count, a position, and a derived speed. Each is registered once
during initialization as a function over the state, and the same values are
readable from outside the page while the game runs.

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chamber</title>
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
import { chamber } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) throw new Error("missing canvas #game");

const engine = createEngine({
  canvas,
  width: 640,
  height: 360,
  background: "#05060a",
  game: chamber,
});

await engine.initialize();
await engine.run();
```

The boot module registers nothing. Sources belong to the game, so the values on
the overlay stay in step with the state that produces them.

## src/game.ts

```ts
import { quatFromAxisAngle, vec3Length } from "@test-cabinet/simple-3d";
import type {
  CameraState,
  Game,
  InitApi,
  LightState,
  Quat,
  RenderApi,
  Transform,
  UpdateApi,
  Vec3,
} from "@test-cabinet/simple-3d";
import type { DeepReadonly } from "ts-essentials";

const RADIUS = 0.4;
const BOUNDS: Vec3 = { x: 6, y: 3, z: 4 };

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 2, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.15),
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

export interface ChamberState {
  readonly phase: "serve" | "rally";
  readonly serveIn: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly bounces: number;
  readonly fps: number;
}

interface Axis {
  readonly p: number;
  readonly v: number;
  readonly hit: boolean;
}

function bounce(p: number, v: number, limit: number): Axis {
  const edge = limit - RADIUS;
  if (p < -edge) return { p: -2 * edge - p, v: -v, hit: true };
  if (p > edge) return { p: 2 * edge - p, v: -v, hit: true };
  return { p, v, hit: false };
}

function edges(h: Vec3): readonly (readonly Vec3[])[] {
  const c = (sx: number, sy: number, sz: number): Vec3 => ({
    x: sx * h.x,
    y: sy * h.y,
    z: sz * h.z,
  });
  return [
    [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), c(-1, -1, -1)],
    [c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1), c(-1, 1, -1)],
    [c(-1, -1, -1), c(-1, 1, -1)],
    [c(1, -1, -1), c(1, 1, -1)],
    [c(1, -1, 1), c(1, 1, 1)],
    [c(-1, -1, 1), c(-1, 1, 1)],
  ];
}

export const chamber: Game<ChamberState, null> = {
  initialize(api: InitApi<ChamberState>): [ChamberState, null] {
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("bounces", (s) => s.bounces);
    api.diagnostics.register("ball", (s) => ({
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
    }));
    api.diagnostics.register("speed", (s) => vec3Length(s.velocity));
    api.diagnostics.register("fps", (s) => s.fps);

    return [
      {
        phase: "serve",
        serveIn: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 3.2, y: 2.5, z: 2.1 },
        bounces: 0,
        fps: 0,
      },
      null,
    ];
  },

  update(state: DeepReadonly<ChamberState>, api: UpdateApi, dt: number): ChamberState {
    const fps = Math.round(1000 / Math.max(api.frame().lastDeltaMs, 1));

    if (state.phase === "serve") {
      const serveIn = state.serveIn - dt;
      if (serveIn > 0) return { ...state, fps, serveIn };
    }

    const x = bounce(state.position.x + state.velocity.x * dt, state.velocity.x, BOUNDS.x);
    const y = bounce(state.position.y + state.velocity.y * dt, state.velocity.y, BOUNDS.y);
    const z = bounce(state.position.z + state.velocity.z * dt, state.velocity.z, BOUNDS.z);
    const hits = [x, y, z].filter((axis) => axis.hit).length;

    return {
      ...state,
      phase: "rally",
      fps,
      position: { x: x.p, y: y.p, z: z.p },
      velocity: { x: x.v, y: y.v, z: z.v },
      bounces: state.bounces + hits,
    };
  },

  render(state: DeepReadonly<ChamberState>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    for (const line of edges(BOUNDS)) {
      scene.drawLine(line, "#31405a");
    }

    const ball: Transform = {
      position: { x: state.position.x, y: state.position.y, z: state.position.z },
      rotation: IDENTITY,
      scale: ONE,
    };
    scene.drawGeometry(scene.createSphere(RADIUS), "#7fd1ff", ball);
  },
};
```

## Sources over the state

Each source takes the state and reads off it. The engine evaluates the sources
on each read, handing each one the state current at that moment, so a line
reports what the game holds at that instant rather than the opening value
`initialize` returned. `InitApi<ChamberState>` is what types the argument.

The five sources cover the shapes the overlay formats. A string prints as
itself, an integer prints whole, a non-integer prints to three decimal places,
and a small object prints as JSON. `speed` derives its value with `vec3Length`
rather than storing it, which is the pattern for any figure that is a function
of fields the state already holds.

`fps` comes from the frame counter, so `update` carries it in the state it
returns and the source reads the field. `api.frame()` belongs to the frame the
counter describes, and the source runs after that frame's render.

## Reading the values back

The overlay is what a person reads the sources off. The backtick key brings it
up, so this build binds no key of its own and leaves that key free of gameplay
bindings. The overlay draws on the engine's own 2D surface composited above the
3D picture, so nothing of it enters a recording of the frames beneath.

A check reads the same values by holding the engine rather than the page. It
constructs the engine over this build's `chamber` module, steps it with
`engine.advance`, and reads `engine.state`, so what it asserts on is the value
the sources are handed.
