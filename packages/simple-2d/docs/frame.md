# The frame

The engine owns the frame loop. A game hands it two functions and never touches
`requestAnimationFrame`.

```ts
interface FrameCallbacks {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}

engine.frame.run(callbacks: FrameCallbacks): void;
engine.frame.stop(): void;
engine.frame.info(): FrameInfo;
```

## `run` and `stop`

`run` starts the loop. Calling `run` again while the loop is running swaps the
callbacks in place; it does not start a second loop.

`stop` halts the loop and drops any frame already scheduled. `run` starts it
again. A pause screen is usually better written as a flag inside `update`, so
the game keeps rendering while paused:

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

## The update / render split

`update(dt)` advances the simulation. `render(ctx)` draws it. They run in that
order, once each, every frame.

Keep them separate in the way the split implies: `update` changes state and
draws nothing, `render` draws and changes nothing. State mutated during `render`
is invisible to the delta-time checks a run performs, and the two functions are
stepped independently by a driver.

The `ctx` passed to `render` is already cleared and already carries the logical
viewport transform. Draw in logical coordinates. Any context state the game
leaves behind is discarded, because the transform is replaced at the top of the
next frame.

## `dt` is seconds

`dt` is the real elapsed time for this frame, **in seconds**. A 60 Hz display
hands the game roughly `0.0167`.

| Property | Value |
| --- | --- |
| Unit | Seconds. |
| Lower bound | `0`. The first frame after `run` reports `0`. |
| Upper bound | `0.1`. A backgrounded tab returns a clamped step. |

The clamp means real time and simulated time diverge whenever the browser stops
delivering frames. That is deliberate: the game behaves as if it paused while
the tab was hidden, instead of integrating thirty seconds in one step and
tunnelling through its own walls.

Anything that must track wall time regardless — a countdown that should keep
running while the tab is hidden — reads `Date.now()` for itself.

## No fixed timestep

The engine never accumulates and never fixes the step. There is no
`FIXED_DT`, and no guarantee that any two frames step by the same amount.

Every rate the game writes down is therefore per second, and every use of it is
multiplied by `dt`.

Incorrect — assumes a step count:

```ts
const GRAVITY = 0.5;

update() {
  ball.vy += GRAVITY;      // per frame
  ball.y += ball.vy;       // per frame
  ball.vx *= 0.99;         // per frame
  fuse -= 1;               // frames, not seconds
}
```

That game runs at half speed on a 30 Hz display and at double speed on a 120 Hz
one. Under a jittered clock it produces a different result every run.

Correct — integrates against `dt`:

```ts
const GRAVITY = 1800;        // logical pixels per second squared
const DAMPING_PER_SECOND = 0.55;

update(dt) {
  ball.vy += GRAVITY * dt;
  ball.y += ball.vy * dt;
  ball.vx *= Math.pow(DAMPING_PER_SECOND, dt);
  fuse -= dt;                // seconds
}
```

Three rules cover almost everything:

- A velocity is per second, so a position gains `velocity * dt`.
- An acceleration is per second squared, so a velocity gains `accel * dt`.
- An exponential decay is a per-second factor raised to `dt`, never a
  per-frame factor multiplied in.

Timers, cooldowns, and animation clocks all count in seconds:

```ts
cooldown = Math.max(0, cooldown - dt);
if (engine.input.pressed("fire") && cooldown === 0) {
  fire();
  cooldown = 0.25;         // seconds
}
```

## Building a fixed step on top

A game that needs a fixed step for its own reasons — deterministic collision
resolution, a lockstep replay — builds one from the delta it is given:

```ts
const STEP = 1 / 120;      // seconds
let accumulator = 0;

update(dt) {
  accumulator += dt;
  while (accumulator >= STEP) {
    world.step(STEP);
    accumulator -= STEP;
  }
}
```

The `while` is bounded, because `dt` is already clamped to `0.1` seconds: at
most twelve inner steps can run in one frame.

## `info()`

```ts
interface FrameInfo {
  count: number;        // frames run since the loop started
  timeMs: number;       // accumulated simulated time, in milliseconds
  lastDeltaMs: number;  // the step the most recent frame took, in milliseconds
}
```

`timeMs` and `lastDeltaMs` are milliseconds; `dt` is seconds. `timeMs` is the
sum of the deltas the loop actually delivered, which is simulated time and not
wall time — clamped frames do not add the time they discarded.
