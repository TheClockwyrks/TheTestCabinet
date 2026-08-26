# The frame

The engine owns the frame loop. A game supplies `update` and `render` on its
`Game` object and never touches `requestAnimationFrame`.

```ts
engine.run(options?: RunOptions): Promise<void>;
engine.advance(frames: number): Promise<void>;
engine.setClock(clock: Clock): void;
engine.frame(): FrameInfo;
```

## What happens in a frame

1. The canvas is resynced to its element and the device pixel ratio, and the
   viewport is recomputed.
2. The picture is blanked: the frame clears to `background`, or to transparency
   where none was given, with the depth state reset.
3. `update(state, api, dt)` runs, with `dt` in seconds, and the state it
   returns replaces the current one.
4. `render(state, api)` runs over that next state, issuing its draws into the
   scene context; the renderer pins the fit as its device viewport and scissor,
   clears the letterbox bars, and the picture is complete when `render` returns.
5. The diagnostics overlay is drawn on its own 2D surface above the finished
   picture, and the input frame is closed so an edge-triggered action is
   consumed exactly once.

Step 1 happens every frame rather than from a `resize` handler, so the fit is
correct on first paint, after a window resize, after a device-pixel-ratio
change, and after a layout change no `resize` event fires for.

Step 2 is why every frame draws the complete picture. There is no retained
scene graph: what survives a frame boundary is the renderer state alone — the
camera, the lights, and the render mode. See `drawing.md`.

## `run`

`run` drives frames off the host's frame callback, and the returned promise
resolves once the loop halts. A loop halts when the supplied signal aborts or
when the engine is destroyed.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

A game that ends itself creates an `AbortController` in its own `initialize`,
keeps it in the state, and aborts it from `update`. Ending the game is then the
game's own state rather than an engine operation.

```ts
interface State {
  readonly ending: AbortController;
  readonly lives: number;
}

const game: Game<State, null> = {
  initialize() {
    return [{ ending: new AbortController(), lives: 3 }, null];
  },
  update(state) {
    if (state.lives <= 0) state.ending.abort();
    return state;
  },
  render() {},
};

const engine = createEngine({ canvas, width: 640, height: 360, game });
const state = await engine.initialize();
await engine.run({ signal: state.ending.signal });
```

Omitting the signal runs until the engine is destroyed. Calling `run` while the
loop is already running resolves against the same halt rather than starting a
second loop. Aborting a signal halts the loop and leaves the engine usable, so
aborting and destroying are separate acts.

A pause screen is usually better written as a flag inside `update`, so the game
keeps rendering while paused:

```ts
update(state, api, dt) {
  const paused = api.input.pressed("pause") ? !state.paused : state.paused;
  if (paused) return { ...state, paused };
  return { ...state, paused, world: stepWorld(state.world, dt) };
}
```

Returning the state unchanged is how a frame that advances nothing is written;
returning nothing is refused.

## `advance`

`advance` ticks the clock `frames` times, back to back, with no host frame
callback in between. The elapsed real time has no effect on the result, so there
is nothing to wait for or poll.

```ts
await engine.advance(120);
```

A tick the clock declines runs no frame, so a clock that supplies its own deltas
turns `frames` ticks into exactly that many frames. `frames` must be a whole,
non-negative number, and `advance(0)` runs nothing.

Pair `advance` with a clock that supplies its own deltas. A clock that reads the
host timestamp reports near-zero deltas here, because no real time passes
between the frames.

## Clocks

A clock decides what each frame's delta time is. The engine holds exactly one,
supplied through `EngineOptions.clock` and replaceable through
`engine.setClock`.

```ts
interface Clock {
  delta(nowMs: number): number | null;
}
```

The result is the frame's delta in milliseconds, or `null` when this tick is not
a frame. A `null` leaves the simulation and the frame counter untouched, which
is how a clock paces below the rate its ticks arrive at.

| Clock | Constructor | Delta | Skips |
| --- | --- | --- | --- |
| `WallClock` | `new WallClock(maxDeltaMs?)` | Real elapsed time since the previous frame, floored at `0` and clamped to `maxDeltaMs` (default `100`). | Never. |
| `PacedClock` | `new PacedClock(fps, options?)` | One frame interval. | Ticks arriving before the next grid slot. |
| `ConstantClock` | `new ConstantClock(stepMs)` | `stepMs`, every frame. | Never. |
| `SequenceClock` | `new SequenceClock(stepsMs)` | The next entry, cycling. | Never. |
| `JitterClock` | `new JitterClock(minMs, maxMs, seed)` | A seeded draw from `[minMs, maxMs]`. | Never. |

`WallClock` and `PacedClock` read the host timestamp. The other three ignore it,
so they produce the same sequence of deltas under `run` and under `advance`.

A build in the browser takes `WallClock` by omitting the option. Its clamp bounds
what a single frame can be worth, so a tab that stops receiving frames resumes as
though the game paused for the gap.

`PacedClock` puts frame `n` at `t0 + n * 1000 / fps`, declines a tick that
arrives early, and delivers exactly one interval for each tick it accepts, so a
frame that overruns shortens the wait for the next one instead of drifting.
`PacedClockOptions.resyncAfter` (default `4`) bounds the catch-up: once the grid
falls further behind than that, the missed slots are dropped and the grid
restarts from the current tick.

`ConstantClock` is what makes a scripted run exact: advancing `n` frames adds
exactly `n * stepMs` of simulated time. `SequenceClock` states an uneven but
reproducible pattern, and `JitterClock` draws from a seeded range — a delta is a
function of the seed and the frame index alone — so a claim that a build is
delta-time independent replays exactly.

Each constructor rejects its arguments where they are supplied, with a
`RangeError` naming the offending value: a `maxDeltaMs`, `fps`, or `stepMs` that
is not finite and positive, a `resyncAfter` below `1`, an empty `SequenceClock`
or a step of one that is not finite and positive (naming the value and its
index), and `JitterClock` bounds that are not finite and positive, are the wrong
way round, or a seed that is not finite.

## `FrameInfo`

```ts
interface FrameInfo {
  count: number;
  timeMs: number;
  lastDeltaMs: number;
}
```

| Field | Meaning |
| --- | --- |
| `count` | Frames run since the loop started. |
| `timeMs` | Accumulated simulated time in milliseconds: the sum of the deltas delivered. |
| `lastDeltaMs` | The delta the most recent frame was stepped by, in milliseconds. |

`timeMs` is the sum of the deltas rather than elapsed wall time, so it means the
same thing under `run` and under `advance`. It is read from `engine.frame()` and
from `api.frame()` inside `update` and `render`, and it is the `t` a cue event
carries. See `audio.md`.

`timeMs` and `lastDeltaMs` are milliseconds; the `dt` passed to `update` is
seconds.

`setClock` replaces the clock in place: the frame counter and the accumulated
time carry over, and the new clock takes effect on the next frame.

## Delta time

Integrate against `dt` rather than assuming a frame rate. Every speed is stated
in world units per second and multiplied by `dt`:

```ts
return {
  ...state,
  position: vec3Add(state.position, vec3Scale(state.velocity, dt)),
  velocity: { ...state.velocity, y: state.velocity.y - GRAVITY * dt },
};
```

A game that needs a fixed timestep builds one on top of the delta it is handed,
accumulating `dt` in its own state and stepping while the accumulator exceeds
the step.

## Errors

| Condition | Result |
| --- | --- |
| `run` or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| `update` or `render` throws under `run` | The error reaches the host, and the loop schedules the next frame |
| `update` or `render` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |
| `update` returns `undefined` | `Error` naming `must return the next state`, thrown as above; the engine keeps the state it had |

A throw under `run` leaves the loop alive so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.
