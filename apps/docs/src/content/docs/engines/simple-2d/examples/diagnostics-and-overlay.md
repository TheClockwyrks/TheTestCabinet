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
import { createEngine } from "@clockwyrks/simple-2d";
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
import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

const BALL = 8;
const SPEED = 220;

interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface RallyState {
  readonly phase: "serve" | "rally";
  readonly serveIn: number;
  readonly ball: Ball;
  readonly score: { readonly left: number; readonly right: number };
  readonly fps: number;
}

function serve(
  state: DeepReadonly<RallyState>,
  width: number,
  height: number,
  vx: number,
): RallyState {
  return {
    ...state,
    phase: "serve",
    serveIn: 1,
    ball: { x: width / 2, y: height / 2, vx, vy: SPEED / 2 },
  };
}

export const rally: Game<RallyState, null> = {
  initialize(api: InitApi<RallyState>): [RallyState, null] {
    const { width, height } = api.viewport();

    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("score", (s) => `${s.score.left} - ${s.score.right}`);
    api.diagnostics.register(
      "ball",
      (s) => `${s.ball.x.toFixed(0)}, ${s.ball.y.toFixed(0)}`,
    );
    api.diagnostics.register("speed", (s) => Math.hypot(s.ball.vx, s.ball.vy));
    api.diagnostics.register("fps", (s) => s.fps);

    return [
      {
        phase: "serve",
        serveIn: 1,
        ball: { x: width / 2, y: height / 2, vx: SPEED, vy: SPEED / 2 },
        score: { left: 0, right: 0 },
        fps: 0,
      },
      null,
    ];
  },

  update(state: DeepReadonly<RallyState>, api: UpdateApi, dt: number): RallyState {
    const { width, height } = api.viewport();
    const fps = Math.round(1000 / Math.max(api.frame().lastDeltaMs, 1));

    if (state.phase === "serve") {
      const serveIn = state.serveIn - dt;
      if (serveIn > 0) return { ...state, fps, serveIn };
    }

    const x = state.ball.x + state.ball.vx * dt;
    const y = state.ball.y + state.ball.vy * dt;
    const vy = y < BALL || y > height - BALL ? -state.ball.vy : state.ball.vy;
    const moved: RallyState = {
      ...state,
      phase: "rally",
      fps,
      ball: { ...state.ball, x, y, vy },
    };

    if (x < BALL) {
      const score = { ...moved.score, right: moved.score.right + 1 };
      return serve({ ...moved, score }, width, height, SPEED);
    }
    if (x > width - BALL) {
      const score = { ...moved.score, left: moved.score.left + 1 };
      return serve({ ...moved, score }, width, height, -SPEED);
    }
    return moved;
  },

  render(state: DeepReadonly<RallyState>, api: RenderApi): void {
    const { ctx } = api;
    ctx.fillStyle = "#7fd1ff";
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL, 0, Math.PI * 2);
    ctx.fill();
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

## Reading the values back

The overlay is what a person reads the sources off. The backtick key brings it
up, so this build binds no key of its own and leaves that key free of gameplay
bindings.

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
overlay. Drawing the panel and toggling it belong to the engine.
