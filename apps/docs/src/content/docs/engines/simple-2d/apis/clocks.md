---
title: Clocks
---

A clock decides what each frame's delta time is. The engine holds exactly one,
supplied at construction and replaceable through
[`engine.setClock`](/engines/simple-2d/apis/engine/), and it is the only thing
that decides how much simulated time a frame is worth.

## `Clock`

```ts
interface Clock {
  delta(nowMs: number): number | null;
}
```

| Parameter | Meaning |
| --- | --- |
| `nowMs` | The host timestamp for this tick, in milliseconds, on the same time base as `performance.now`. |

The result is the frame's delta in milliseconds, or `null` when this tick is not
a frame. A `null` leaves the simulation untouched and the frame counter
unchanged.

A clock is called once per tick, and a tick is either a host frame callback
under [`engine.run`](/engines/simple-2d/apis/engine/) or one step of
[`engine.advance`](/engines/simple-2d/apis/engine/). A clock that ignores
`nowMs` therefore produces the same sequence of deltas under both, which is what
lets a validator step a scenario synchronously and a reviewer watch the same
scenario play.

## The catalogue

| Clock | Constructor | Delta | Skips |
| --- | --- | --- | --- |
| `WallClock` | `new WallClock(maxDeltaMs?)` | Real elapsed time since the previous frame, floored at `0` and clamped to `maxDeltaMs`. | Never. |
| `PacedClock` | `new PacedClock(fps, options?)` | One frame interval. | Ticks arriving before the next grid slot. |
| `ConstantClock` | `new ConstantClock(stepMs)` | `stepMs`, every frame. | Never. |
| `SequenceClock` | `new SequenceClock(stepsMs)` | The next entry, cycling. | Never. |
| `JitterClock` | `new JitterClock(minMs, maxMs, seed)` | A seeded draw from `[minMs, maxMs]`. | Never. |

`WallClock` and `PacedClock` read `nowMs`. The other three ignore it.

## `WallClock`

```ts
class WallClock implements Clock {
  constructor(maxDeltaMs?: number);
  delta(nowMs: number): number;
}
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `maxDeltaMs` | `100` | The longest delta a frame may report. |

The first frame reports `0`, because a delta needs a previous frame to measure
from. A timestamp behind the previous one reports `0` as well, so the simulation
advances by nothing rather than running backwards.

The clamp bounds what a single frame can be worth. A tab that stops receiving
frames resumes as though the game paused for the gap, which keeps a long
absence from handing the simulation a step it was never written to survive.

## `PacedClock`

```ts
class PacedClock implements Clock {
  constructor(fps: number, options?: PacedClockOptions);
  delta(nowMs: number): number | null;
}

interface PacedClockOptions {
  resyncAfter?: number;
}
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `fps` | — | Target frames per second. Finite and positive. |
| `resyncAfter` | `4` | Intervals behind the grid at which the clock abandons the missed slots and restarts from the current tick. |

Frame `n` is due at `t0 + n * 1000 / fps`. A tick before the next due time
returns `null`; a tick at or after it returns one interval and moves the grid on
by one. A frame that overruns therefore shortens the wait for the next one, so
the cadence holds its average rate instead of drifting by the overrun on every
frame.

Every delivered frame is worth exactly one interval, whatever the tick's real
arrival time. That keeps the delta the game integrates against equal to the
delta the pacing targets, and it is what makes a paced run reproducible.

`resyncAfter` bounds the catch-up. Once the grid falls further behind than that,
the missed slots are dropped and the grid restarts from the current tick, so a
long stall costs the game a pause rather than a burst of frames replaying time
the player did not experience.

The display's refresh rate bounds what pacing can deliver. A target above it
yields a frame per tick, and a target it does not divide evenly yields the
nearest slot to each ideal instant.

## `ConstantClock`

```ts
class ConstantClock implements Clock {
  constructor(stepMs: number);
  delta(): number;
}
```

Every frame is worth `stepMs`, which must be finite and positive. Advancing `n`
frames therefore adds exactly `n * stepMs` of simulated time.

## `SequenceClock`

```ts
class SequenceClock implements Clock {
  constructor(stepsMs: number[]);
  delta(): number;
}
```

The deltas are delivered in order and the list repeats. It needs at least one
entry, each finite and positive.

This is how an uneven but reproducible frame pattern is expressed: a long frame
every so often, a stutter, a burst of short frames.

## `JitterClock`

```ts
class JitterClock implements Clock {
  constructor(minMs: number, maxMs: number, seed: number);
  delta(): number;
}
```

| Parameter | Meaning |
| --- | --- |
| `minMs` | The shortest delta. Finite and positive. |
| `maxMs` | The longest delta. Finite, positive, and at least `minMs`. |
| `seed` | Seeds the draw. Finite. |

A delta is a function of the seed and the frame index alone, so frame `i` under
seed `s` has one answer however that frame was reached. The seed is required,
because a claim that a build is delta-time independent is worth making only when
the failing case replays exactly.

## Errors

Each constructor rejects its arguments where they are supplied, naming the
offending value.

| Condition | Result |
| --- | --- |
| `WallClock` with a `maxDeltaMs` that is not finite and positive | `RangeError` |
| `PacedClock` with an `fps` that is not finite and positive | `RangeError` |
| `PacedClock` with a `resyncAfter` below `1` | `RangeError` |
| `ConstantClock` with a `stepMs` that is not finite and positive | `RangeError` |
| `SequenceClock` with no steps | `RangeError` |
| `SequenceClock` with a step that is not finite and positive | `RangeError` naming the value and its index |
| `JitterClock` with bounds that are not finite and positive | `RangeError` naming both bounds |
| `JitterClock` with `maxMs` below `minMs` | `RangeError` naming both bounds |
| `JitterClock` with a non-finite `seed` | `RangeError` |

## Exports

`Clock`, `PacedClockOptions`, `WallClock`, `PacedClock`, `ConstantClock`,
`SequenceClock`, and `JitterClock` are exported from
`@test-cabinet/simple-2d`.
