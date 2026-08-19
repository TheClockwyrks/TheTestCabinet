---
title: The Frame
---

The engine owns the frame loop. A game supplies two functions, an update and a
render, and the loop decides when each frame happens. The game schedules
nothing.

## Delta time

Every frame hands the update the real elapsed time for that frame, in seconds.
Seconds are the unit a 2D game already writes its quantities in: pixels per
second, pixels per second squared, a cooldown measured in seconds.

The loop neither accumulates the delta nor fixes the step. Two consecutive
frames step by whatever the clock delivered, and a game integrates against the
delta time it is given. A game that wants a fixed timestep for its own reasons
builds one on top of that delta, which keeps the choice with the game rather
than imposing one on every game.

Under the wall clock a step is clamped to 100 milliseconds and floored at zero.
A tab that stops delivering frames resumes as though the game paused for the
gap, and a non-monotonic timestamp advances the simulation by nothing rather
than rewinding it.

Clamping makes real time and simulated time diverge whenever the browser stops
delivering frames, and the loop reports simulated time: the sum of the deltas it
actually delivered. Anything that must track wall time regardless reads the wall
clock for itself.

A frame with no baseline before it reports a zero step. That is the first frame
after the loop starts, and the first frame after the clock returns to the wall
clock, where charging the game for the gap would advance the simulation by time
that did not elapse under the loop.

## Update and render

Each frame runs the update once and then the render once. The update advances
the simulation by the delta it is given; the render draws the state the update
left behind.

After the render, the engine's own per-frame work runs: the debug overlay is
drawn over the finished picture, and the input frame is closed so an
edge-triggered action is consumed exactly once.

The loop owns when a frame happens, never what it draws on. The canvas, its
letterboxing, and its device-pixel-ratio scaling belong to the engine, which
prepares the drawing context and supplies it to the render. A loop with no
destination still runs the render, which is what lets a build be stepped
headlessly.

Keeping the two halves separate is what makes the simulation examinable on its
own: a delta-time check steps the update repeatedly and reads the outcome
without the rendering taking part in the result.

## The clock

The clock behind the delta time is replaceable, and which one is in force
decides where a frame's time comes from.

The auto clock is the wall clock driving `requestAnimationFrame`. It is what a
player gets, and it is the clock a build runs under unless a driver takes it.

The manual clock hands the frame loop to the host interface. Frames run only
when a driver asks for them, each taking its delta from a schedule, and a
request for a given number of frames runs exactly that many synchronously. A
validation script counting ticks therefore never sleeps, never polls, and never
has to tolerate a slow machine. Stepping is available under the manual clock
only, because interleaved wall-clock frames the driver did not ask for would
quietly break the exact frame count that is the manual clock's whole purpose.

Manual steps carry no ceiling. A scheduled step is delivered exactly as
scheduled, so a driver can pose a frame of any duration.

Switching clocks is safe at any point, including from inside a frame. Taking the
manual clock drops the frame the wall clock had pending, and handing the clock
back starts from no baseline so the game is not charged for the real time that
elapsed while the manual clock was stepping.

## Schedules

A schedule is the delta pattern the manual clock walks. Three kinds cover what a
driver needs to say.

- `fixed` steps by the same amount every frame. It is the reference a comparison
  is made against.
- `sequence` walks a list of deltas in order and cycles once it runs off the
  end. This is how an uneven but reproducible pattern is expressed: a long frame
  every so often, a stutter, a burst of short frames.
- `jitter` draws each delta uniformly between a floor and a ceiling, which is
  the closest a schedule comes to what a real display delivers.

Jitter carries a required seed, so a run that failed replays exactly.

A schedule is evaluated as a pure function of the schedule and the frame index,
with no state carried between frames. The delta for frame 900 under a given seed
is the same whether that frame was reached by running 900 frames or asked for
directly, so a failing run replays step for step and a jittered pattern cannot
drift out of step with the frame counter.

Installing a schedule restarts it at its first step, so a schedule means the
same thing however many frames preceded it. The loop keeps its own copy of the
pattern, so nothing outside it can alter the deltas of a run in progress.

Until a driver installs one, the manual clock runs a fixed schedule of
`1000 / 120` milliseconds, which is 120 Hz. That is the rate cases instrument
at, so a case declaring a `tick_hz` of 120 counts one step as one tick without
installing a schedule of its own.

## What one step means

One step of the manual clock is one frame. The frame counter is therefore the
tick unit a validation script asserts against, and it counts the same thing
under every schedule: a schedule changes what a frame is worth in simulated
milliseconds, never what a frame is. A check written as a number of ticks reads
identically under a fixed step, an uneven sequence, and a seeded jitter.

Alongside the counter the loop reports the accumulated simulated time and the
delta the most recent frame was stepped by. The accumulated time is the sum of
the deltas delivered rather than elapsed wall time, and the most recent delta is
how a driver confirms that the schedule it installed took effect.

## Delta-time independence

Because one scenario can be posed once and then driven under several schedules,
a build that advances per frame rather than per second is directly detectable
rather than merely suspected. Such a build traces the same path through the
field whatever the step size, but it cannot take the same amount of simulated
time to trace it, and simulated time comes from the engine's own frame clock.

A comparison across schedules holds to outcomes that survive a legitimate change
in step size: whether an event occurred, which side scored, what state the
result left behind, and how much game time the scenario took. Numerical
integration of a nonlinear system diverges across step sizes even when every
step of it is correct, so exact positions are not outcomes a correct build is
required to reproduce.
