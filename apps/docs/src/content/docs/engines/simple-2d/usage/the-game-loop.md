---
title: The Game Loop
---

A build writes one [`Game<S, D>`](/engines/simple-2d/apis/game/): `initialize`
returns the state beside the game's debug surface, `update` returns the next
state from the current one and the frame's delta, and `render` draws it. The
engine owns the loop, runs `update` and then `render` once per frame, and hands
each function only the part of itself that function may use.

```ts
import type { Game } from "@clockwyrks/simple-2d";

const TURN_RATE = 260; // logical pixels per second squared
const THRUST = 420; // logical pixels per second squared
const DRAG_PER_SECOND = 0.6;

interface State {
  readonly ship: {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
  };
  readonly sprite: ImageBitmap;
  readonly score: number;
}

export const game: Game<State, null> = {
  async initialize(api) {
    api.input.register("left", { keys: ["ArrowLeft", "KeyA"] });
    api.input.register("right", { keys: ["ArrowRight", "KeyD"] });
    api.input.register("thrust", { keys: ["ArrowUp", "KeyW"] });
    api.audio.define("boost", { freq: 180, freqTo: 520, durationMs: 120 });

    const sprite = await api.assets.loadImage("sprites/ship.png");
    return [{ ship: { x: 320, y: 180, vx: 0, vy: 0 }, sprite, score: 0 }, null];
  },

  update(state, api, dt) {
    const turn = api.input.value("right") - api.input.value("left");
    const thrusting = api.input.pressed("thrust");
    if (thrusting) api.audio.play("boost");

    const vx =
      (state.ship.vx + turn * TURN_RATE * dt) * Math.pow(DRAG_PER_SECOND, dt);
    const vy = state.ship.vy - (thrusting ? THRUST * dt : 0);
    return {
      ...state,
      ship: { x: state.ship.x + vx * dt, y: state.ship.y + vy * dt, vx, vy },
    };
  },

  render(state, api) {
    api.ctx.drawImage(state.sprite, state.ship.x - 16, state.ship.y - 16);
  },
};
```

`update` reads input and plays cues; `render` draws. Both receive the state as
a `DeepReadonly` view, so the only way a frame changes anything is the value
`update` returns: a frame's audible and observable behavior is decided entirely
by `update`, and the picture follows from the state it returned.

The `ctx` handed to `render` is already cleared and already carries the logical
viewport transform, so drawing is in the design size the engine was created
with. Context state left behind at the end of a frame is discarded, because the
transform is replaced at the top of the next one.

## Booting the engine

The game is bound when the engine is created, and initialization is a separate
step that resolves to the state.

```ts
import { createEngine } from "@clockwyrks/simple-2d";
import { game } from "./game";

const engine = createEngine({ canvas, width: 640, height: 360, game });

const opening = await engine.initialize();
await engine.run();
```

`engine.state` reads the current value, the one the most recent frame or
[`engine.apply`](/engines/simple-2d/apis/engine/) left. Reading it before
`initialize` resolves throws, and `apply`, `run`, and `advance` throw before it
too, so the ordering is enforced where a mistake happens rather than several
frames later.

## The state is a value

`initialize` returns the state as the first element of its pair. Each frame the
engine hands the current value to `update`, keeps what `update` returns, and
hands that to `render`. Everything a frame needs is therefore reachable from a
value the type system already checked, every field of it is present the moment
a frame can observe it, and a reader holds nothing a later frame writes to.

`update` builds the next state from the current one with spread, `map`, and
small helpers, and returns it. A frame that changes nothing returns the state
it was given. Returning `undefined` is refused with an error naming the rule,
and the engine keeps the state it had.

```ts
update(state, api, dt) {
  if (state.phase !== "rally") return state;
  return { ...state, ball: integrate(state.ball, dt) };
}
```

A module-level variable belongs to the module, so every engine built from that
module shares it and its values outlive the run that produced them. Returned
state belongs to the engine, so a second engine over the same game module starts
from its own. That is what lets a validator construct the engine once per test,
in one process, and get an independent scenario each time.

Module scope is for constants: speeds, sizes, tuning numbers, and the cue specs
a build declares once.

## Loading in `initialize`

`initialize` may return a promise, and the engine awaits it before running any
frame. A game that needs assets loads them here and places the results in the
state, so `update` and `render` receive a state whose fields are all loaded.

```ts
interface State {
  readonly sprites: { readonly ship: ImageBitmap; readonly rock: ImageBitmap };
  readonly score: number;
}

async initialize(api) {
  await api.audio.load("music", "audio/theme.ogg");
  const [ship, rock] = await Promise.all([
    api.assets.loadImage("sprites/ship.png"),
    api.assets.loadImage("sprites/rock.png"),
  ]);
  return [{ sprites: { ship, rock }, score: 0 }, null];
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

A diagnostic source registered in `initialize` is handed the state current at
each read, so it reads the field off its argument.

```ts
async initialize(api) {
  api.diagnostics.register("score", (s) => s.score);
  return [{ sprites: await loadSprites(api), score: 0 }, null];
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

| Quantity     | Unit                | Applied as                     |
| ------------ | ------------------- | ------------------------------ |
| Velocity     | Per second          | `position + velocity * dt`     |
| Acceleration | Per second squared  | `velocity + accel * dt`        |
| Decay        | A per-second factor | `value * Math.pow(factor, dt)` |

Timers, cooldowns, and animation clocks count in seconds the same way.

```ts
update(state, api, dt) {
  const cooldown = Math.max(0, state.cooldown - dt);
  if (api.input.pressed("fire") && cooldown === 0) {
    return fire({ ...state, cooldown: 0.25 });   // seconds
  }
  return { ...state, cooldown };
}
```

## Pausing

A pause is a flag in the state, read at the top of `update`. The game keeps
rendering while it is paused, so the pause screen draws over the world it
suspended.

```ts
update(state, api, dt) {
  const paused = api.input.pressed("pause") ? !state.paused : state.paused;
  if (paused) return { ...state, paused };
  return step({ ...state, paused }, api, dt);
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
  readonly lives: number;
  readonly ended: AbortController;
}

async initialize(api) {
  return [{ lives: 3, ended: new AbortController() }, null];
},

update(state, api, dt) {
  if (state.lives === 0) state.ended.abort();
  return state;
}
```

The controller is a handle the state carries rather than a field it changes, so
aborting it is a call on a value the view hands back as it is. The caller passes
that signal to `run` and waits on it.

```ts
const opening = await engine.initialize();
await engine.run({ signal: opening.ended.signal });
showResults(engine.state);
```

Ending the game is then the game's own state, and the same signal composes with
whatever else the page cancels on teardown. `engine.state` after `run` resolves
is the value the final frame left, which is what the results screen reads.

## A fixed step on top

A build that needs a fixed step of its own, for deterministic collision
resolution or a lockstep replay, accumulates the delta it is given and keeps the
accumulator in its state.

```ts
const STEP = 1 / 120;      // seconds
const MAX_STEPS = 8;

update(state, api, dt) {
  let next = state;
  let accumulator = state.accumulator + dt;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    next = stepWorld(next, STEP);
    accumulator -= STEP;
    steps += 1;
  }
  return { ...next, accumulator: Math.min(accumulator, STEP) };
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
