---
title: Simple 2D
---

Simple 2D (slug `simple-2d`) is the 2D engine of the Simple family. It ships as
the npm package `@test-cabinet/simple-2d`, is written entirely in TypeScript, and
is imported by a build as an ordinary dependency.

## Creating the engine

`createEngine` takes a canvas and a logical design size and returns an engine
carrying the frame, input, audio, asset, and diagnostic services:

```ts
const engine = createEngine({ canvas, width: 960, height: 540 });

engine.frame.run({
  update(dt) {},                 // dt is seconds
  render(ctx) {},                // ctx is a CanvasRenderingContext2D
});
```

The width and height are the logical size the game draws in. The engine
letterboxes and scales that size to the canvas and handles the device pixel
ratio, so fitting the window is engine-owned and a game works in fixed logical
coordinates.

## The frame

The engine owns the frame loop. A game supplies an update taking a delta time in
seconds and a render taking a 2D drawing context, and the engine calls both each
frame.

The delta time is the real elapsed time for that frame, clamped to a maximum so a
backgrounded tab cannot hand the game an unbounded step. The engine neither
accumulates nor fixes the step, so a game integrates against the delta time it is
given.

## Input actions

A game registers named actions and binds them to keyboard codes. A binding states
whether a digital action is read as held or as edge-triggered, and an
edge-triggered press is consumed once per frame.

The engine owns the binding table, the key and pointer handling behind it, and
the on-screen controls a touchscreen needs. A game selects a touch layout, which
fixes both the on-screen controls and the action vocabulary they drive.

### Touch layouts

| Layout | Controls | Actions |
| --- | --- | --- |
| `dual-vertical` | Two vertical sliders, one per side | `p1-up`, `p1-down`, `p2-up`, `p2-down` |
| `single-vertical` | One vertical slider | `up`, `down` |
| `dpad-4` | A four-way pad | `up`, `down`, `left`, `right` |
| `dpad-4-two-buttons` | The pad plus two buttons | `up`, `down`, `left`, `right`, `a`, `b` |

Every layout also carries `confirm`, `back`, `pause`, and `mute`. A case names
the layout its game uses and names any action it needs beyond that vocabulary.

## Audio

A game defines a cue as a synthesis description, stating a waveform, a frequency
envelope, a gain envelope, and a duration, and plays it by name. The engine owns
the Web Audio graph, the mute state, and the first-interaction unlock a browser
requires before audio may start. Every cue played records a semantic entry in the
cue log.

## Assets

A game loads an asset by path. Paths resolve under the fixed `assets/` root, and
every resolution is recorded in the asset log.

## Diagnostics

A game registers named diagnostic sources, each a function returning the value to
show. The engine draws the overlay, owns its toggle, and evaluates the same
sources a driver reads.

## The host interface

`createEngine` installs the host interface on `window.__tcabEngine`, at version
`1`. It is engine code, so every build carries it. Its types are exported from
`@test-cabinet/simple-2d/host`.

### Clock

- `setClock(mode)` selects `"auto"`, the wall clock, or `"manual"`.
- `setSchedule(spec)` sets the schedule the manual clock steps at.
- `advance(steps)` runs exactly that many frames off the current schedule,
  synchronously.
- `frame()` reports `{ count, timeMs, lastDeltaMs }`.

A driver takes the manual clock, sets a schedule, and advances frame by frame.
One step is one scheduled frame, so a tick-counted check reads the same units
under every schedule.

| Kind | Spec | Steps |
| --- | --- | --- |
| `fixed` | `{ kind: "fixed", stepMs }` | The same step every frame. The default, at 1/120 s. |
| `sequence` | `{ kind: "sequence", stepsMs }` | The listed steps, cycled. |
| `jitter` | `{ kind: "jitter", minMs, maxMs, seed }` | Seeded steps drawn from the range. |

Driving one scenario under several schedules and comparing the outcomes is how a
case establishes that a build is delta-time independent.

### Input

- `actions()` returns the registered set, each `{ name, keys, kind, layout }`.
  Reading it is a static inspection, so confirming that a build registered and
  bound every expected action needs no simulated keystrokes.
- `setAction(name, value)` and `pressAction(name)` drive an action directly.
- `layout()` reports the selected touch layout and its vocabulary.

### Audio, assets, and diagnostics

- `audioLog()` returns `[{ cue, t, gain }]` and `audioState()` returns
  `{ muted, unlocked }`, so a driver establishes that a build played a cue in
  response to an event.
- `assetLog()` returns `[{ path, url, ok }]`, the paths a build requested and
  whether each resolved.
- `diagnostics()` returns the registered sources evaluated, and `setOverlay(b)`
  toggles the overlay.
