---
title: Frame
---

The frame loop as a game holds it, and the types the loop is described in. The
clock and schedule operations a driver calls are on the
[host interface](/engines/simple-2d/apis/host/).

## `engine.frame`

```ts
readonly frame: {
  run(cb: FrameCallbacks): void;
  stop(): void;
  info(): FrameInfo;
};
```

| Method | Effect |
| --- | --- |
| `run(cb)` | Start driving `cb`. Under the auto clock this schedules the first frame; under the manual clock it records the callbacks, since frames run only when a driver advances. Calling `run` again while the loop is running swaps the callbacks in place and starts no second loop. |
| `stop()` | Halt the loop and drop any frame already scheduled. `run` starts it again. |
| `info()` | The frame counter, the accumulated simulated time, and the most recent step. |

## `FrameCallbacks`

The two functions a game hands the loop. They run in this order, once each,
every frame.

```ts
interface FrameCallbacks {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}
```

| Member | Type | Meaning |
| --- | --- | --- |
| `update` | `(dt: number) => void` | Advance the simulation by `dt` seconds of real elapsed time. |
| `render` | `(ctx: CanvasRenderingContext2D) => void` | Draw the frame. `ctx` is cleared and already carries the logical viewport transform, so drawing is in logical coordinates. |

### `dt`

| Property | Value |
| --- | --- |
| Unit | Seconds. |
| Lower bound | `0` under the auto clock: the first frame after `run` and the first frame after the clock returns to auto have no timestamp baseline. Under the manual clock every frame takes the schedule's step, which is required to be positive. |
| Upper bound under the auto clock | `0.1`. A step longer than 100 milliseconds is clamped to it. |
| Bound under the manual clock | None. A scheduled step is delivered as scheduled. |

## `FrameInfo`

```ts
interface FrameInfo {
  count: number;
  timeMs: number;
  lastDeltaMs: number;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `count` | `number` | Frames run since the loop started. This is the tick unit a validation script asserts against. |
| `timeMs` | `number` | Accumulated simulated time in milliseconds: the sum of the deltas delivered, not elapsed wall time. |
| `lastDeltaMs` | `number` | The delta the most recent frame was stepped by, in milliseconds. |

`timeMs` and `lastDeltaMs` are milliseconds; the `dt` passed to `update` is
seconds.

## `ClockMode`

```ts
type ClockMode = "auto" | "manual";
```

| Value | Meaning |
| --- | --- |
| `"auto"` | The wall clock driving `requestAnimationFrame`. |
| `"manual"` | The clock belongs to the host interface, and each frame's delta comes from the current `Schedule`. |

## `Schedule`

```ts
type Schedule = ScheduleFixed | ScheduleSequence | ScheduleJitter;
```

The delta pattern the manual clock advances on. Every step in every kind must be
a finite, positive number of milliseconds.

### `ScheduleFixed`

```ts
interface ScheduleFixed {
  kind: "fixed";
  stepMs: number;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `"fixed"` | Discriminant. |
| `stepMs` | `number` | The delta, in milliseconds, handed to every frame. Finite and positive. |

### `ScheduleSequence`

```ts
interface ScheduleSequence {
  kind: "sequence";
  stepsMs: number[];
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `"sequence"` | Discriminant. |
| `stepsMs` | `number[]` | The deltas in milliseconds, replayed in order and then repeated. At least one entry, each finite and positive. |

### `ScheduleJitter`

```ts
interface ScheduleJitter {
  kind: "jitter";
  minMs: number;
  maxMs: number;
  seed: number;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `"jitter"` | Discriminant. |
| `minMs` | `number` | The shortest delta, in milliseconds. Finite and positive. |
| `maxMs` | `number` | The longest delta, in milliseconds. Finite, positive, and at least `minMs`. |
| `seed` | `number` | Seeds the delta draw so a run replays exactly. Required, and finite. |

A jittered delta is a function of the seed and the frame index alone, so frame
`i` under seed `s` has one answer however that frame was reached.

### The default schedule

```ts
{ kind: "fixed", stepMs: 1000 / 120 }
```

The manual clock walks this until a schedule is installed. It is 120 Hz, the
rate cases instrument at.

## Errors

| Condition | Result |
| --- | --- |
| A schedule with a `kind` outside the union | `Error` naming the kind. |
| A `fixed` schedule whose `stepMs` is not finite and positive | `Error` naming the value. |
| A `sequence` schedule with no steps | `RangeError`. |
| A `sequence` schedule with a step that is not finite and positive | `Error` naming the value and its index. |
| A `jitter` schedule whose bounds are not finite and positive | `Error` naming both bounds. |
| A `jitter` schedule with `maxMs` below `minMs` | Throws, naming both bounds. |
| A `jitter` schedule with a non-finite `seed` | `Error` naming the seed. |
| Advancing while the auto clock is in force | `Error`. |
| Advancing by a value that is not a whole, non-negative count | `RangeError` naming the value. |

## Exports

`FrameCallbacks`, `FrameInfo`, `ClockMode`, `Schedule`, `ScheduleFixed`,
`ScheduleSequence`, and `ScheduleJitter` are exported as types from
`@test-cabinet/simple-2d`.
