---
title: The Frame
---

The engine owns the frame loop. A game supplies controllers, actors, components,
and a game mode, and the loop decides when each frame happens, how much time it
is worth, and in what order those pieces run. The game schedules nothing.

## Delta time

Every frame hands each `tick` the elapsed time for that frame, in seconds.
Seconds are the unit a game already writes its quantities in: world units per
second, world units per second squared, radians per second, a cooldown measured
in seconds.

Each frame steps by whatever the clock delivered, and a game integrates against
the delta it is given. A game that wants a fixed timestep builds one on top of
that delta, which keeps the choice with the game.

The loop reports simulated time: the sum of the deltas it delivered. That
diverges from wall time whenever the browser stops delivering frames or a clock
supplies its own deltas, and a game that must track wall time reads the wall
clock for itself.

Simulated time is kept in two places. `world.time` is the seconds the open world
has been stepped by, and it restarts at zero on every level transition. The
frame counter and the accumulated simulated time belong to the engine and
survive every transition.

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
| `timeMs` | Accumulated simulated time, in milliseconds. |
| `lastDeltaMs` | The most recent frame's delta, in milliseconds. |

`engine.frame()` and `world.frame()` both return it.

## Frame order

A frame runs eleven steps, in this order:

1. The clock is called once for the tick. A declined tick ends the frame here,
   so the clock decides whether there is a frame at all before any state moves.
2. The frame counter, `timeMs`, and `world.time` advance by the delta. Time
   moves first, so everything that runs in the frame reads one clock reading.
3. The recorder's frame opens, the stage canvas and the screen layer's canvas
   are synced to the surface's size and ratio, and the viewport is recomputed.
   The fit is taken before any game code runs, so a tick that converts a point
   uses the fit this frame renders through.
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
10. The camera updates and the pipeline renders, then the debug overlay draws.
    The picture is drawn from the world the frame settled on, in this order:
    1. The camera updates. A camera following a view target adopts the
       target's world position, rotation, and field of view, and its position
       is then clamped to its bounds.
    2. Each enabled, visible world-space render component's object is synced:
       rebuilt if its declaration changed, placed at the component's world
       transform, its visibility and opacity applied, a billboard turned to the
       camera, and a model's mixer advanced by the delta while the world is
       running.
    3. The canvas is cleared to `background`, the letterboxed viewport and
       scissor are applied, and the scene is rendered through the camera under
       the render mode.
    4. The collision overlay draws, when it is enabled.
    5. The screen layer is cleared and given the viewport transform, and every
       enabled, visible screen-space component draws in layer order.
    6. The recorder's frame closes.
    7. The diagnostics overlay draws on the screen layer in device space.
    8. Under `webgl`, the screen layer is composited over the picture.
11. The input frame closes, discarding every edge left unconsumed. It closes
    last so every controller that ticked this frame had its chance to consume an
    edge.

Under the `headless` backend the render, the collision overlay, and the
composite produce no pixels, and every other part of step 10 runs as it does
under `webgl`. The scene is synced, its world matrices are updated, the screen
layer draws through its 2D context, and the recorder captures the frame, so
what a caller reads off the scene, the screen layer, and a recording is the
same with or without a renderer.

A transition is asynchronous because the incoming level's `load` is, and the
loop runs no frame while one is in flight. The frame that performs the
transition renders the world it opened.

Drawing belongs to the pipeline, and reading input and playing cues belong to
the ticks. A frame's audible and observable behavior therefore comes from the
ticks and its picture from the pipeline, so a simulation is examinable
independently of any drawing surface.

## A paused world

Steps 4 through 8 are skipped while the world is paused: the controller ticks,
the actor and component ticks, the timers, the collision pass, and the game
mode's tick. An actor whose `tickWhenPaused` is `true` ticks anyway, together
with its components, which is how a pause menu drives itself.

The remaining steps run as usual. A paused world still advances the frame
counter, still renders, and still closes its input frame, so an edge is consumed
exactly once while paused. A model's animation is advanced by the world's
delta, so a paused world holds every pose where it stood.

## The clock

A [clock](/engines/structured-3d/apis/clocks/) answers one question: how much
time is this frame worth. It is the single seam behind delta time, supplied when
the engine is built and replaceable afterwards.

The engine calls the clock once per tick. A tick is a host frame callback while
the game runs, or one step of an explicit advance. A clock that ignores the host
timestamp therefore produces the same deltas under both, so the sequence a
validator steps through synchronously is the sequence a reviewer watches play.
The same deltas drive the same controllers, actors, and game mode in the same
order, so the stepped scenario reaches the states the reviewer sees.

A clock may decline a tick. Returning `null` leaves the simulation and the
frame counter untouched, which is how a clock paces below the rate its ticks
arrive at.

The two real-time clocks read the host timestamp. The wall clock reports the
time that actually elapsed, and the paced clock reports its own fixed interval.
The three scripted clocks supply deltas from a constant, a repeating list, or a
seeded draw, and ignore the timestamp entirely.

## Pacing

A paced clock holds an ideal grid: frame `n` is due at `n` intervals after the
first. A tick before the next due time is declined, and a tick at or after it
delivers one interval and moves the grid on by one.

The grid is what keeps a cadence from drifting. A frame that overruns its
interval shortens the wait for the next one, so the average rate holds instead
of losing the overrun on every frame.

Every delivered frame is worth exactly one interval, whatever the tick's real
arrival time. The delta the game integrates against therefore equals the delta
the pacing targets, which is what makes a paced run reproducible.

Falling far enough behind abandons the missed slots and restarts the grid from
the current tick. A long stall costs the game a pause, in place of a burst of
frames replaying time the player did not experience.

The rate ticks arrive at bounds what pacing can deliver. A target above it
yields a frame per tick, and a target it does not divide evenly yields the
nearest slot to each ideal instant.

## Clamping

The wall clock bounds what a single frame can be worth, and floors it at zero. A
tab that stops receiving frames resumes as though the game paused for the gap,
and a timestamp behind the previous one advances the simulation by nothing.

A frame with no baseline before it reports zero. That is the first frame after
the loop starts, where charging the game for time before it began would advance
the simulation by time that did not elapse under the loop.

## Delta-time independence

Running one scenario under several clocks and comparing the outcomes is how a
build is shown to integrate against the delta it is given rather than against a
count of frames. A constant clock, a repeating sequence, and a seeded jitter
cover the ground between them.

Compare the elapsed simulated time and the outcomes that survive a change in
step size: the match phase, which side scored, which actors are alive, which
controller holds which pawn, and the level the run ended in. Numerical
integration of a nonlinear system diverges across step sizes even when every
step of it is correct, so exact positions, rotations, and velocities differ
legitimately between two correct runs.
