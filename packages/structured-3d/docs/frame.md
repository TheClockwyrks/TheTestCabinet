# The frame

The engine owns the frame loop. A game supplies controllers, actors, components,
and a game mode, and the loop decides when each frame happens, how much time it
is worth, and in what order those pieces run. The game schedules nothing and
never touches `requestAnimationFrame`.

```ts
engine.run(options?: RunOptions): Promise<void>;
engine.advance(frames: number): Promise<void>;
engine.setClock(clock: Clock): void;
engine.frame(): FrameInfo;
```

## Frame order

A frame runs eleven steps, in this order:

1. The clock is called once for the tick. A declined tick ends the frame here,
   so the clock decides whether there is a frame at all before any state moves.
2. The frame counter, `timeMs`, and `world.time` advance by the delta. Time
   moves first, so everything that runs in the frame reads one clock reading.
3. The stage canvas and the screen layer's canvas are synced to the surface's
   size and ratio, and the viewport is recomputed. The fit is taken before any
   game code runs, so a tick that converts a point uses the fit this frame
   renders through.
4. Each controller ticks, in the order they were added. A controller writes the
   drive for the pawn it possesses, and it runs first so the pawn's own tick
   sees that drive in the same frame.
5. Each live actor ticks in spawn order, and after each actor its enabled
   components tick in attachment order. An actor settles its transform and its
   components follow from it.
6. Timers due this frame fire, in scheduling order. A timer runs after the ticks
   so it observes the world this frame already moved.
7. The collision pass runs and emits its events. It follows every actor's
   movement, so a pair this frame's movement produced is reported in this frame.
8. The game mode ticks. It runs after collision so the mode decides the match
   from a settled world, with this frame's overlaps and hits already reported.
9. Deferred work flushes: destroyed actors end play and leave the world, then a
   requested level transition is performed. Removal waits until every tick is
   finished, so a tick never observes a half-removed world.
10. The pipeline renders and the debug overlay draws, in eight sub-steps:
    1. The camera updates. A camera following a view target adopts the target's
       world position, rotation, and field of view, and its position is then
       clamped to its bounds.
    2. Each enabled, visible world-space component's three object is synced:
       rebuilt if its declaration changed, placed at the component's world
       transform, its visibility and opacity applied, a billboard turned to the
       camera, and a model's mixer advanced by the delta.
    3. The canvas is cleared to `background`, the letterboxed viewport and
       scissor are applied, and the scene is rendered through the camera under
       the render mode.
    4. The collision overlay draws, when it is enabled.
    5. The screen layer is cleared and given the viewport transform, and every
       enabled, visible screen-space component draws in layer order.
    6. The recorder captures the frame, when it is armed.
    7. The diagnostics overlay draws on the screen layer in device space.
    8. The screen layer is composited over the picture.
11. The input frame closes, discarding every edge left unconsumed. It closes
    last so every controller that ticked this frame had its chance to consume an
    edge.

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline.

The recorder sits between the screen pass and the overlay, so every recording
holds the render mode, the collision overlay, and a `DrawComponent`'s drawing,
and nothing of the debug overlay. See `recording.md`.

## `run`

`run` drives frames off the host's frame callback, and the returned promise
resolves once the loop halts. A loop halts when the supplied signal aborts or
when the engine is destroyed.

```ts
const controller = new AbortController();
await engine.run({ signal: controller.signal });
```

Omitting the signal runs until the engine is destroyed. Calling `run` while the
loop is already running resolves against the same halt rather than starting a
second loop.

A level transition is asynchronous, because a level's `load` is. The loop runs
no frame while one is in flight, and the canvas keeps the last frame it drew.

## `advance`

`advance` ticks the clock `frames` times, back to back, with no host frame
callback in between. The elapsed real time has no effect on the result, so there
is nothing to wait for or poll.

```ts
await engine.advance(120);
```

A tick the clock declines runs no frame, so a clock that supplies its own deltas
turns `frames` ticks into exactly that many frames. `frames` must be a whole,
non-negative number, and `advance(0)` runs nothing. A level transition requested
during a frame completes before the next frame begins, and `advance` awaits it,
so the frames it runs are frames of a settled world.

Pair `advance` with a clock that supplies its own deltas. A clock that reads the
host timestamp reports near-zero deltas here, because no real time passes
between the frames.

## Clocks

A clock decides what each frame's delta time is. The engine holds exactly one,
supplied through `EngineOptions.clock` and replaceable through
`engine.setClock`, and it is the only thing that decides how much simulated time
a frame is worth.

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

A build in the browser takes `WallClock` by omitting the option. Its clamp
bounds what a single frame can be worth, so a tab that stops receiving frames
resumes as though the game paused for the gap, and its first frame reports `0`,
because a delta needs a previous frame to measure from.

`PacedClock` holds an ideal grid: frame `n` is due at `n` intervals after the
first. A tick before the next due time is declined, and a tick at or after it
delivers exactly one interval and moves the grid on by one, so a frame that
overruns shortens the wait for the next one and the average rate holds. Falling
more than `resyncAfter` intervals behind (default `4`) abandons the missed slots
and restarts the grid from the current tick. Choose it for a game whose feel
depends on a steady rate.

`ConstantClock` is what makes a scripted run exact: advancing `n` frames adds
exactly `n * stepMs` of simulated time. `SequenceClock` states an uneven but
reproducible pattern, and `JitterClock` draws from a seeded range — a delta is a
function of the seed and the frame index alone — so a claim that a build is
delta-time independent replays exactly.

Each constructor rejects its arguments where they are supplied, with a
`RangeError` naming the offending value.

`setClock` replaces the clock in place, and the frame counter and accumulated
time carry over. A clock installed mid-run takes effect on the next frame.

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
| `count` | Frames delivered since the loop started. |
| `timeMs` | Accumulated simulated time, in milliseconds: the sum of the deltas delivered. |
| `lastDeltaMs` | The delta the most recent frame was stepped by, in milliseconds. |

`timeMs` is the sum of the deltas rather than elapsed wall time, so it means the
same thing under `run` and under `advance`. `engine.frame()`, `world.frame()`,
and a `DrawComponent`'s `api.frame()` all return the same shape.

Simulated time is kept in two places. `world.time` is the **seconds** the open
world has been stepped by, and it restarts at zero on every level transition.
The frame counter and `timeMs` belong to the loop and survive every transition.

## Delta time

`dt` is seconds; `timeMs` and every clock delta are milliseconds. Integrate
against `dt` rather than assuming a frame rate. Every speed is stated per second
and multiplied by `dt`:

```ts
import { add, scale } from "@clockwyrks/structured-3d";

override tick(dt: number): void {
  this.velocity = add(this.velocity, scale(GRAVITY, dt));
  this.transform.position = add(this.transform.position, scale(this.velocity, dt));
}
```

A game that needs a fixed timestep builds one on top of the delta it is handed,
accumulating `dt` in its own state and stepping while the accumulator exceeds
the step.

## A paused world

Steps 4 through 8 are skipped while the world is paused: the controller ticks,
the actor and component ticks, the timers, the collision pass, and the game
mode's tick. An actor whose `tickWhenPaused` is `true` ticks anyway, together
with its components, which is how a pause menu drives itself. See `worlds.md`.

The remaining steps run as usual. A paused world still advances the frame
counter, still renders, and still closes its input frame, so an edge is consumed
exactly once while paused. A `ModelComponent`'s mixer is advanced by the world's
delta, so a paused world holds every animated pose where it stood.

## Errors

| Condition | Result |
| --- | --- |
| `run` or `advance` reached before `initialize` resolves | `Error` naming the ordering |
| `advance` with a count that is not a whole, non-negative number | `RangeError` naming the value |
| A tick or a `draw` throws under `run` | The error reaches the host, and the loop schedules the next frame |
| A tick or a `draw` throws under `advance` | `advance` rejects with the cause, and the remaining frames do not run |

A throw under `run` leaves the loop alive so one bad frame does not freeze the
game permanently. A throw under `advance` stops immediately, because a caller
stepping an exact number of frames needs the failure rather than the frames
after it.
