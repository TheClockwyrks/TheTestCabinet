---
title: The Game Loop
---

A build hands the engine an `update` and a `render` and calls
`engine.frame.run` once.

```ts
const engine = createEngine({ canvas, width: 640, height: 360 });

engine.frame.run({
  update(dt) {
    world.step(dt);
  },
  render(ctx) {
    world.draw(ctx);
  },
});
```

`run` is the last call a typical build makes at startup. Everything after that
happens inside the two callbacks.

## `update` changes state, `render` draws it

Keep the halves separate in the way the split implies. `update` advances the
simulation and draws nothing. `render` draws and changes nothing.

The `ctx` handed to `render` is already cleared and already carries the logical
viewport transform, so drawing is in the logical design size the engine was
created with. Context state left behind at the end of a frame is discarded,
because the transform is replaced at the top of the next one.

## `dt` is seconds

`dt` is the real elapsed time for the frame, in seconds. A 60 Hz display hands
the build roughly `0.0167`, and under the auto clock a step longer than `0.1`
seconds arrives clamped to `0.1`.

There is no fixed timestep and no guarantee that two frames step by the same
amount. Every rate a build writes down is therefore per second, and every use of
it is multiplied by `dt`.

Integrating against `dt` gives the same behaviour at every frame rate:

```ts
const GRAVITY = 1800;            // logical pixels per second squared
const DAMPING_PER_SECOND = 0.55;

update(dt) {
  ball.vy += GRAVITY * dt;
  ball.y += ball.vy * dt;
  ball.vx *= Math.pow(DAMPING_PER_SECOND, dt);
  fuse -= dt;                    // seconds
}
```

Three rules cover almost every quantity a 2D game has:

| Quantity | Unit | Applied as |
| --- | --- | --- |
| Velocity | Per second | `position += velocity * dt` |
| Acceleration | Per second squared | `velocity += accel * dt` |
| Decay | A per-second factor | `value *= Math.pow(factor, dt)` |

Timers, cooldowns, and animation clocks count in seconds the same way:

```ts
cooldown = Math.max(0, cooldown - dt);
if (engine.input.pressed("fire") && cooldown === 0) {
  fire();
  cooldown = 0.25;               // seconds
}
```

## Pausing

`stop` halts the loop and drops the frame already scheduled, and `run` starts it
again. A pause screen is usually better as a flag inside `update`, so the game
keeps rendering while it is paused:

```ts
let paused = false;

engine.frame.run({
  update(dt) {
    if (engine.input.pressed("pause")) paused = !paused;
    if (paused) return;
    world.step(dt);
  },
  render(ctx) {
    world.draw(ctx);
    if (paused) drawPauseOverlay(ctx);
  },
});
```

Calling `run` a second time swaps the callbacks in place, which is how a build
that wants a different loop for a different screen changes over.

## A fixed step on top

A build that needs a fixed step of its own, for deterministic collision
resolution or a lockstep replay, accumulates the delta it is given:

```ts
const STEP = 1 / 120;            // seconds
let accumulator = 0;

update(dt) {
  accumulator += dt;
  while (accumulator >= STEP) {
    world.step(STEP);
    accumulator -= STEP;
  }
}
```

Under the auto clock the `0.1` second ceiling bounds that loop at twelve inner
steps in one frame. A driver-installed schedule delivers its step unclamped, so
an accumulator that must stay bounded under validation caps its own iteration
count.

## Reading the loop back

`engine.frame.info()` reports the frame counter, the accumulated simulated time
in milliseconds, and the milliseconds the most recent frame stepped by. It is a
plain read, useful as a diagnostic source:

```ts
engine.diagnostics.register("fps", () =>
  Math.round(1000 / engine.frame.info().lastDeltaMs),
);
```

Accumulated simulated time is the sum of the deltas the loop delivered, so a
clamped frame contributes only the time it delivered. Anything that must track
wall time while the tab is hidden reads `Date.now()` for itself.
