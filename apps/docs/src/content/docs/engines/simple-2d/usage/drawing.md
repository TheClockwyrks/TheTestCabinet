---
title: Drawing
---

Everything a game draws goes inside `render(ctx)`, and the context it receives
already carries the viewport transform. Draw in logical coordinates: `(0, 0)` is
the top-left of the design field and `(width, height)` is its bottom-right,
whatever size the canvas element happens to be.

```ts
engine.frame.run({
  update(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  },
  render(ctx) {
    ctx.fillStyle = "#1b1b2a";
    ctx.fillRect(0, 0, 640, 360);

    ctx.fillStyle = "#7fd1ff";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
    ctx.fill();
  },
});
```

The `640 × 360` in that fill is the design size the engine was created with, not
a measurement. Every coordinate a build writes is in the design size. The
letterbox and the device pixel ratio are already folded into the transform, so
`engine.viewport()` is the one place a build reads how that field currently sits
on the element.

## Every frame draws the whole picture

The engine clears the canvas before each frame, so `render` starts from a blank
field and must lay down everything that should be visible. There is no partial
redraw and no dirty-rectangle bookkeeping to maintain.

Draw back to front: background, then the play field, then entities, then any
in-game HUD.

```ts
render(ctx) {
  drawField(ctx);
  for (const brick of bricks) drawBrick(ctx, brick);
  drawPaddle(ctx, paddle);
  drawBall(ctx, ball);
  drawScore(ctx, score);
}
```

## Context state

The transform is replaced at the top of every frame, so a `translate`, `rotate`,
or `scale` left behind at the end of `render` is discarded rather than
compounding. Balance `save` and `restore` around a transformed subtree anyway,
so the rest of that same frame draws where it meant to.

```ts
render(ctx) {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.fillStyle = "#f5d76e";
  ctx.fillRect(-10, -6, 20, 12);
  ctx.restore();

  drawHud(ctx);
}
```

## Text

Font sizes are logical units like everything else, so text scales with the rest
of the picture as the window changes size.

```ts
ctx.font = "16px monospace";
ctx.fillStyle = "#ffffff";
ctx.textAlign = "center";
ctx.fillText(`SCORE ${score}`, 320, 28);
```

## Mapping a pointer into logical coordinates

A pointer event reports a position in CSS pixels relative to the viewport. The
fit reported by `engine.viewport()` converts it into the game's own coordinates.
Read the viewport inside the handler, since the fit changes whenever the element
does.

```ts
canvas.addEventListener("pointerdown", (event) => {
  const vp = engine.viewport();
  if (vp.scale === 0) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = ((event.clientX - rect.left) * dpr - vp.offsetX) / vp.scale;
  const y = ((event.clientY - rect.top) * dpr - vp.offsetY) / vp.scale;

  aimAt(x, y);
});
```

`vp.scale` and the offsets are in device pixels, which is why the CSS-space
position is multiplied by the device pixel ratio before the letterbox bar is
subtracted. A point inside a letterbox bar maps outside `0..width` or
`0..height`; clamp it or ignore it, whichever the game wants.

Prefer registered actions over raw pointer handling for anything a case checks,
so a validator can drive it. Pointer mapping suits aiming and direct
manipulation, where the position itself is the input.
