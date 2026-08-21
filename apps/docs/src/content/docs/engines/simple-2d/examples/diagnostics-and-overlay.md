---
title: Diagnostics and Overlay
---

A build that names the values a reviewer would otherwise read off the pixels: a
phase, a score, a position, and a derived speed. Each is registered once during
initialization as a function over the state the game is about to run, and the
same values are readable from outside the page while the game runs.

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
import { createEngine } from "@test-cabinet/simple-2d";
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
} from "@test-cabinet/simple-2d";

const BALL = 8;
const SPEED = 220;

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface RallyState {
  phase: "serve" | "rally";
  serveIn: number;
  ball: Ball;
  score: { left: number; right: number };
  fps: number;
}

function serve(
  state: RallyState,
  width: number,
  height: number,
  vx: number,
): void {
  state.phase = "serve";
  state.serveIn = 1;
  state.ball = { x: width / 2, y: height / 2, vx, vy: SPEED / 2 };
}

export const rally: Game<RallyState> = {
  initialize(api: InitApi): RallyState {
    const { width, height } = api.viewport();
    const state: RallyState = {
      phase: "serve",
      serveIn: 1,
      ball: { x: width / 2, y: height / 2, vx: SPEED, vy: SPEED / 2 },
      score: { left: 0, right: 0 },
      fps: 0,
    };

    api.diagnostics.register("phase", () => state.phase);
    api.diagnostics.register(
      "score",
      () => `${state.score.left} - ${state.score.right}`,
    );
    api.diagnostics.register("ball", () => ({
      x: state.ball.x,
      y: state.ball.y,
    }));
    api.diagnostics.register("speed", () =>
      Math.hypot(state.ball.vx, state.ball.vy),
    );
    api.diagnostics.register("fps", () => state.fps);

    return state;
  },

  update(state: RallyState, api: UpdateApi, dt: number): void {
    const { width, height } = api.viewport();
    const ball = state.ball;

    state.fps = Math.round(1000 / Math.max(api.frame().lastDeltaMs, 1));

    if (state.phase === "serve") {
      state.serveIn -= dt;
      if (state.serveIn > 0) return;
      state.phase = "rally";
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.y < BALL || ball.y > height - BALL) ball.vy = -ball.vy;

    if (ball.x < BALL) {
      state.score.right += 1;
      serve(state, width, height, SPEED);
    } else if (ball.x > width - BALL) {
      state.score.left += 1;
      serve(state, width, height, -SPEED);
    }
  },

  render(state: RallyState, api: RenderApi): void {
    const { ctx } = api;
    ctx.fillStyle = "#7fd1ff";
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, BALL, 0, Math.PI * 2);
    ctx.fill();
  },
};
```

## Sources over the state

Each source closes over the `state` object `initialize` is about to return,
which is the same value every frame reads and writes. The engine evaluates the
sources on each read, so a line reports what the game holds at that instant
rather than what it held at registration.

The five sources cover the shapes the overlay formats. A string prints as
itself, an integer prints whole, a non-integer prints to three decimal places,
and a small object prints as JSON.

`fps` comes from the frame counter, so `update` captures it into the state and
the source reads the field. `api.frame()` belongs to the frame the counter
describes, and the source runs after that frame's render.

## Reading the values back

The overlay is what a person reads the sources off. The backtick key brings it
up, so this build binds no key of its own and leaves that key free of gameplay
bindings.

A check reads the same values by holding the engine rather than the page. It
constructs the engine over this build's `rally` module, steps it with
`engine.advance`, and reads `state` directly, so what it asserts on is the
object the sources close over.
