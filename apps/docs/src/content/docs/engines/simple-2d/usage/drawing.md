---
title: Drawing
---

Everything a game draws goes inside `render(state, api)` and reaches the canvas
through `api.ctx`. The context arrives cleared and already carrying the viewport
transform, so drawing is in logical coordinates: `(0, 0)` is the top-left of the
design field and `(width, height)` is its bottom-right, whatever size the canvas
element happens to be.

```ts
import type { Game } from "@test-cabinet/simple-2d";

interface State {
  readonly ball: {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
  };
}

const game: Game<State, null> = {
  initialize() {
    return [{ ball: { x: 320, y: 180, vx: 180, vy: 90 } }, null];
  },
  update(state, api, dt) {
    const vp = api.viewport();
    const y = state.ball.y + state.ball.vy * dt;
    const vy = y < 0 || y > vp.height ? -state.ball.vy : state.ball.vy;
    return { ball: { ...state.ball, x: state.ball.x + state.ball.vx * dt, y, vy } };
  },
  render(state, api) {
    const { ctx } = api;
    const vp = api.viewport();

    ctx.fillStyle = "#1b1b2a";
    ctx.fillRect(0, 0, vp.width, vp.height);

    ctx.fillStyle = "#7fd1ff";
    ctx.beginPath();
    ctx.arc(state.ball.x, state.ball.y, 6, 0, Math.PI * 2);
    ctx.fill();
  },
};
```

`api.viewport()` reports the design size the engine was created with together
with the fit that size currently sits under. The letterbox bars and the device
pixel ratio are folded into the transform, so a build states every coordinate,
speed, and size in design units and leaves the element's own size to the
engine.

## Render only draws

`render` receives the state as a `DeepReadonly` view and returns nothing, so
the picture is a function of the state `update` returned and the compiler
refuses a render that assigns into it. A value the drawing depends on, such as
an animation phase or a highlighted entity, is computed in `update` and carried
in the state.

`RenderApi` carries the context, the frame counter, and the viewport. Input and
audio are absent from it, so a frame's response to the player is decided
entirely by `update`.

## Every frame draws the whole picture

The engine clears the canvas before each frame, so `render` starts from a blank
field and lays down everything that should be visible. Every frame is a complete
picture, which leaves a build free of dirty-rectangle bookkeeping and makes a
single frame enough to describe what the game looked like at that instant.

Draw back to front: the background, then the play field, then entities, then any
in-game HUD.

```ts
import type { RenderApi } from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";

function render(state: DeepReadonly<Board>, api: RenderApi): void {
  const { ctx } = api;
  drawField(ctx, api.viewport());
  for (const brick of state.bricks) drawBrick(ctx, brick);
  drawPaddle(ctx, state.paddle);
  drawBall(ctx, state.ball);
  drawScore(ctx, state.score);
}
```

## Context state

The transform is replaced at the top of every frame, so a `translate`, `rotate`,
or `scale` left behind at the end of `render` is discarded rather than
compounding into the next frame. Balance `save` and `restore` around a
transformed subtree anyway, so the rest of that same frame draws where it meant
to.

```ts
function render(state: DeepReadonly<Flight>, api: RenderApi): void {
  const { ctx } = api;

  ctx.save();
  ctx.translate(state.ship.x, state.ship.y);
  ctx.rotate(state.ship.angle);
  ctx.fillStyle = "#f5d76e";
  ctx.fillRect(-10, -6, 20, 12);
  ctx.restore();

  drawHud(ctx, state);
}
```

Fill and stroke styles, the font, the alpha, and the line width carry across
draw calls within a frame. Set each one where the drawing that depends on it
happens, so a helper that changes a style leaves its caller drawing in the
color it asked for.

## Text

Font sizes are logical units like every other measurement, so text scales with
the rest of the picture as the window changes size. Set the font, the fill, and
the alignment together, and place the text at a coordinate in the design field.

```ts
function drawScore(ctx: CanvasRenderingContext2D, score: number): void {
  ctx.font = "16px monospace";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`SCORE ${score}`, 320, 28);
}
```

Debug text belongs on the [overlay](/engines/simple-2d/usage/diagnostics/)
instead, which the engine draws over the finished picture in device pixels and a
reviewer toggles on demand.

## Mapping a pointer into logical coordinates

A pointer event reports a position in CSS pixels relative to the browser
viewport. The fit reported by `engine.viewport()` converts it into the game's own
coordinates: multiply by the device pixel ratio, subtract the letterbox bar, and
divide by the scale.

A pointer arrives between frames, so it is folded into the state the way any
change from outside a frame is: through
[`engine.apply`](/engines/simple-2d/apis/engine/), with a transition that
returns the next state from the current one. The listener lives where the
engine is held — beside `createEngine`, not inside the game — and holds nothing
of its own; the position it reads goes straight into the state, and the next
frame's `update` receives it there. Read `engine.viewport()` inside the handler
so the conversion uses the fit in force at that moment.

```ts
import { createEngine } from "@test-cabinet/simple-2d";
import type { Game } from "@test-cabinet/simple-2d";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Aiming {
  readonly aim: Point;
}

const game: Game<Aiming, null> = {
  initialize: () => [{ aim: { x: 320, y: 180 } }, null],
  update: (state, _api, dt) => stepTowards(state, dt),
  render: (state, api) => drawCrosshair(api.ctx, state.aim),
};

const engine = createEngine({ canvas, width: 640, height: 360, game });
await engine.initialize();

canvas.addEventListener("pointerdown", (event) => {
  const vp = engine.viewport();
  if (vp.scale === 0) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const aim: Point = {
    x: ((event.clientX - rect.left) * dpr - vp.offsetX) / vp.scale,
    y: ((event.clientY - rect.top) * dpr - vp.offsetY) / vp.scale,
  };
  engine.apply((state) => ({ ...state, aim }));
});

await engine.run();
```

`vp.scale` and the two offsets are in device pixels, which is why the CSS-space
position is multiplied by the device pixel ratio before the bar is subtracted. A
point inside a letterbox bar maps outside `0..width` or `0..height`, so a game
either clamps it or treats it as a miss.

The listener is attached after `initialize` resolves because `apply` throws
before it, and it is attached per engine, so a second engine over a second
canvas poses its own state and nothing else's. Pointer mapping suits aiming and
direct manipulation, where the position itself is the input. Everything a case
checks belongs behind a registered
[action](/engines/simple-2d/usage/actions/), which a validator drives by name.
