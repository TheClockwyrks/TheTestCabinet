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
  ball: { x: number; y: number; vx: number; vy: number };
}

const game: Game<State> = {
  initialize() {
    return { ball: { x: 320, y: 180, vx: 180, vy: 90 } };
  },
  update(state, api, dt) {
    const vp = api.viewport();
    state.ball.x += state.ball.vx * dt;
    state.ball.y += state.ball.vy * dt;
    if (state.ball.y < 0 || state.ball.y > vp.height) {
      state.ball.vy = -state.ball.vy;
    }
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

## Every frame draws the whole picture

The engine clears the canvas before each frame, so `render` starts from a blank
field and lays down everything that should be visible. Every frame is a complete
picture, which leaves a build free of dirty-rectangle bookkeeping and makes a
single frame enough to describe what the game looked like at that instant.

Draw back to front: the background, then the play field, then entities, then any
in-game HUD.

```ts
import type { RenderApi } from "@test-cabinet/simple-2d";

function render(state: Board, api: RenderApi): void {
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
function render(state: Flight, api: RenderApi): void {
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
viewport. The fit reported by `api.viewport()` converts it into the game's own
coordinates: multiply by the device pixel ratio, subtract the letterbox bar, and
divide by the scale.

Attach the listener in `initialize`, where the state the handler writes into
already exists, and call `api.viewport()` inside the handler so the conversion
uses the fit in force at that moment.

```ts
import type { Game, InitApi } from "@test-cabinet/simple-2d";

interface Aiming {
  aim: { x: number; y: number };
}

function createGame(canvas: HTMLCanvasElement): Game<Aiming> {
  return {
    initialize(api: InitApi): Aiming {
      const state: Aiming = { aim: { x: 320, y: 180 } };

      canvas.addEventListener("pointerdown", (event) => {
        const vp = api.viewport();
        if (vp.scale === 0) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        state.aim.x =
          ((event.clientX - rect.left) * dpr - vp.offsetX) / vp.scale;
        state.aim.y =
          ((event.clientY - rect.top) * dpr - vp.offsetY) / vp.scale;
      });

      return state;
    },
    update(state, api, dt) {
      stepTowards(state, dt);
    },
    render(state, api) {
      drawCrosshair(api.ctx, state.aim);
    },
  };
}
```

`vp.scale` and the two offsets are in device pixels, which is why the CSS-space
position is multiplied by the device pixel ratio before the bar is subtracted. A
point inside a letterbox bar maps outside `0..width` or `0..height`, so a game
either clamps it or treats it as a miss.

Pointer mapping suits aiming and direct manipulation, where the position itself
is the input. Everything a case checks belongs behind a registered
[action](/engines/simple-2d/usage/actions/), which a validator drives by name.
