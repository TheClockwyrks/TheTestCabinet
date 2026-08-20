---
title: The Game Loop
---

A build writes one [`Game<S>`](/engines/simple-2d/apis/game/): `initialize`
returns the state, `update` advances that state by the frame's delta, and
`render` draws it. The engine owns the loop, runs `update` and then `render`
once per frame, and hands each function only the part of itself that function
may use.

```ts
import type { Game } from "@test-cabinet/simple-2d";

const TURN_RATE = 260;   // logical pixels per second squared
const THRUST = 420;      // logical pixels per second squared
const DRAG_PER_SECOND = 0.6;

interface State {
  ship: { x: number; y: number; vx: number; vy: number };
  sprite: ImageBitmap;
  score: number;
}

export const game: Game<State> = {
  async initialize(api) {
    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.input.register("thrust", { keys: ["ArrowUp", "KeyW"] });
    api.audio.define("boost", { freq: 180, freqTo: 520, durationMs: 120 });

    const sprite = await api.assets.loadImage("sprites/ship.png");
    return { ship: { x: 320, y: 180, vx: 0, vy: 0 }, sprite, score: 0 };
  },

  update(state, api, dt) {
    const turn = api.input.value("right") - api.input.value("left");
    state.ship.vx += turn * TURN_RATE * dt;
    if (api.input.pressed("thrust")) {
      state.ship.vy -= THRUST * dt;
      api.audio.play("boost");
    }
    state.ship.vx *= Math.pow(DRAG_PER_SECOND, dt);
    state.ship.x += state.ship.vx * dt;
    state.ship.y += state.ship.vy * dt;
  },

  render(state, api) {
    api.ctx.drawImage(state.sprite, state.ship.x - 16, state.ship.y - 16);
  },
};
```

`update` reads input and plays cues; `render` draws. Keep the halves separate in
the way that split implies, so a frame's audible and observable behavior is
decided entirely by `update` and the picture follows from the state `update`
left behind.

The `ctx` handed to `render` is already cleared and already carries the logical
viewport transform, so drawing is in the design size the engine was created
with. Context state left behind at the end of a frame is discarded, because the
transform is replaced at the top of the next one.

## Booting the engine

The game is bound when the engine is created, and initialization is a separate
step that resolves to the state.

```ts
import { createEngine } from "@test-cabinet/simple-2d";
import { game } from "./game";

const engine = createEngine({ canvas, width: 640, height: 360, game });

const state = await engine.initialize();
await engine.run();
```

`engine.state` exposes that same live value, and reading it before
`initialize` resolves throws. `run` and `advance` throw before it too, so the
ordering is enforced where a mistake happens rather than several frames later.

## The state is returned rather than held in module scope

`initialize` returns the state, and the engine hands that one value to every
`update` and `render`. Everything a frame needs is therefore reachable from a
value the type system already checked, and every field of it is present the
moment a frame can observe it.

A module-level variable belongs to the module, so every engine built from that
module shares it and its values outlive the run that produced them. Returned
state belongs to the engine, so a second engine over the same game module starts
from its own. That is what lets a validator construct the engine once per test,
in one process, and get an independent scenario each time.

Module scope is for constants: speeds, sizes, tuning numbers, and the cue specs
a build declares once.

## Loading in `initialize`

`initialize` may return a promise, and the engine awaits it before running any
frame. A game that needs assets loads them here and stores the results in the
state, so `update` and `render` receive a state whose fields are all loaded.

```ts
interface State {
  sprites: { ship: ImageBitmap; rock: ImageBitmap };
  score: number;
}

async initialize(api) {
  await api.audio.load("music", "audio/theme.ogg");
  const [ship, rock] = await Promise.all([
    api.assets.loadImage("sprites/ship.png"),
    api.assets.loadImage("sprites/rock.png"),
  ]);
  return { sprites: { ship, rock }, score: 0 };
}
```

The state type declares each field as present, and the frame code loads no
placeholder and tests no field for readiness. A load that fails rejects
`engine.initialize` with the cause, so a build that cannot run says so at the
point it was assembled.

Subscribing to `engine.events` before calling `initialize` is what makes each
individual failure visible, since the rejection carries only the first one.

```ts
engine.events.on("asset:failed", (event) => {
  console.error(`${event.path}: ${event.reason}`);
});
```

A diagnostic source registered in `initialize` closes over the state object
built there, which is why the state is assembled before it is returned.

```ts
async initialize(api) {
  const state: State = { sprites: await loadSprites(api), score: 0 };
  api.diagnostics.register("score", () => state.score);
  return state;
}
```

## `dt` is seconds

`dt` is the elapsed time for the frame, in seconds. A 60 Hz display hands the
build roughly `0.0167`, and a wall clock clamps a long absence to its ceiling of
`0.1` seconds.

The step size varies frame to frame, and the clock behind it is chosen when the
engine is built. Every rate a build writes down is therefore per second, and
every use of it is multiplied by `dt`, which is what gives the same behavior at
every frame rate.

| Quantity | Unit | Applied as |
| --- | --- | --- |
| Velocity | Per second | `position += velocity * dt` |
| Acceleration | Per second squared | `velocity += accel * dt` |
| Decay | A per-second factor | `value *= Math.pow(factor, dt)` |

Timers, cooldowns, and animation clocks count in seconds the same way.

```ts
update(state, api, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (api.input.pressed("fire") && state.cooldown === 0) {
    fire(state);
    state.cooldown = 0.25;   // seconds
  }
}
```

## Pausing

A pause is a flag in the state, read at the top of `update`. The game keeps
rendering while it is paused, so the pause screen draws over the world it
suspended.

```ts
update(state, api, dt) {
  if (api.input.pressed("pause")) state.paused = !state.paused;
  if (state.paused) return;
  step(state, api, dt);
},

render(state, api) {
  draw(state, api);
  if (state.paused) drawPauseOverlay(api.ctx);
}
```

## Ending the game

A game that ends itself creates an `AbortController` in `initialize`, keeps it
in the state, and aborts it from `update`. `run` resolves once the signal
aborts, so the loop halts and the engine stays usable.

```ts
interface State {
  lives: number;
  ended: AbortController;
}

async initialize(api) {
  return { lives: 3, ended: new AbortController() };
},

update(state, api, dt) {
  if (state.lives === 0) state.ended.abort();
}
```

The caller passes that signal to `run` and waits on it.

```ts
const state = await engine.initialize();
await engine.run({ signal: state.ended.signal });
showResults(state);
```

Ending the game is then the game's own state, and the same signal composes with
whatever else the page cancels on teardown.

## A fixed step on top

A build that needs a fixed step of its own, for deterministic collision
resolution or a lockstep replay, accumulates the delta it is given and keeps the
accumulator in its state.

```ts
const STEP = 1 / 120;      // seconds
const MAX_STEPS = 8;

update(state, api, dt) {
  state.accumulator += dt;
  let steps = 0;
  while (state.accumulator >= STEP && steps < MAX_STEPS) {
    stepWorld(state, STEP);
    state.accumulator -= STEP;
    steps += 1;
  }
  state.accumulator = Math.min(state.accumulator, STEP);
}
```

The iteration cap bounds the work a single frame can do, and it is the game's to
set, since a scripted clock may deliver a step of any size. Capping the leftover
accumulator alongside it keeps a long delta from spending the next several
frames catching up.

## Reading the loop back

`api.frame()` reports the frame counter, the accumulated simulated time in
milliseconds, and the milliseconds the most recent frame stepped by. It is
available to both `update` and `render`.

```ts
render(state, api) {
  const { count, timeMs, lastDeltaMs } = api.frame();
  drawHud(api.ctx, count, timeMs / 1000, Math.round(1000 / lastDeltaMs));
}
```

Accumulated simulated time is the sum of the deltas the loop delivered, so a
clamped frame contributes only the time it delivered. A build that must track
wall time while the tab is hidden reads `Date.now()` for itself.
