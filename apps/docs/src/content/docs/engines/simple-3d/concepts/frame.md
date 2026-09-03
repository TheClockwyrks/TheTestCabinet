---
title: The Frame
---

The engine owns the frame loop. A game supplies an update and a render, and the
loop decides when each frame happens and how much time it is worth. The game
schedules nothing.

## Delta time

Every frame hands the update the elapsed time for that frame, in seconds.
Seconds are the unit a 3D game already writes its quantities in: world units
per second, world units per second squared, radians per second, a cooldown
measured in seconds.

The loop neither accumulates the delta nor fixes the step. Each frame steps by
whatever the clock delivered, and a game integrates against the delta it is
given. A game that wants a fixed timestep builds one on top of that delta, which
keeps the choice with the game.

The loop reports simulated time: the sum of the deltas it delivered. That
diverges from wall time whenever the browser stops delivering frames or a clock
supplies its own deltas, and a game that must track wall time reads the wall
clock for itself.

## Update and render

Each frame runs the update once and then the render once. The update is handed
the current state as a read-only view and returns the next state; the engine
holds that value, and the render is handed it to draw. The state is therefore a
value each frame replaces rather than an object each frame writes into, and
`engine.state` reads whatever the most recent frame left.

An update that returns `undefined` is refused and the engine keeps the state it
had, because an update that mutated its view and returned nothing has advanced
nothing the engine will read again. The refusal names the rule, and under
`run` it reaches the host while the loop stays alive.

Between frames a caller may pose the game through `engine.apply`, a transition
of the same shape as the update: the current state in, the next state out. The
next frame's update receives the state the transition left.

The render draws on two surfaces. It updates the objects in the engine's
retained [scene](/engines/simple-3d/concepts/rendering/) from the state and
poses the camera, and it draws its readouts on the screen layer through a 2D
context. After the render, the engine's own per-frame work runs: world matrices
are updated and the camera is read into the view, the scene is rendered through
the camera, the recorder captures the frame, the debug overlay is drawn on the
screen layer over the finished picture, the screen layer is composited over the
scene, and the input frame is closed so an edge-triggered action is consumed
exactly once.

Each function receives only the part of the engine it may use. The update reads
input and plays cues with nothing that draws; the render draws with nothing that
reads input or plays a cue, and holds a read-only view of the state, so the
render cannot change the state and nothing but a transition advances it. A
frame's audible and observable behavior therefore belongs entirely to the
update, which is what makes a simulation examinable with no drawing surface
taking part in the result.

## One frame, in order

1. The clock is called once. A declined tick ends the frame.
2. The frame counter, `timeMs`, and `lastDeltaMs` advance.
3. Both canvases are synced to the surface's size and ratio, and the viewport
   is recomputed.
4. The screen layer is cleared and given the viewport transform.
5. `update` runs with the delta in seconds, and the state is replaced.
6. `render` runs: the game updates the scene, poses the camera, and draws on
   the screen layer.
7. The engine updates world matrices, reads the camera into the view, clears
   the canvas to `background`, applies the letterboxed viewport and scissor,
   and renders the scene through the camera.
8. The recorder captures the frame.
9. The diagnostics overlay draws on the screen layer in device space.
10. The screen layer is composited over the picture.
11. The input frame closes.

The scene is touched at steps 6 and 7: the game writes it, and the engine
renders it. The screen layer is touched at steps 4, 6, 8, 9, and 10: cleared
and transformed by the engine, drawn by the game in logical coordinates,
captured into the recording over the picture, drawn by the overlay in device
space, and lifted onto the canvas over the 3D picture. Step 7 is where the
camera the game posed in step 6 becomes the camera the
[view](/engines/simple-3d/concepts/camera-and-view/) answers from, so the next
frame's update picks against the camera the player is looking through.

The recorder captures the frame after the scene is rendered and the screen
layer drawn, and before the diagnostics overlay draws on the screen layer. A
[recording](/engines/simple-3d/concepts/recording/) therefore holds the picture
the game submitted and nothing of the overlay.

## The clock

A [clock](/engines/simple-3d/apis/clocks/) answers one question: how much time
is this frame worth. It is the single seam behind delta time, supplied when the
engine is built and replaceable afterwards.

The engine calls the clock once per tick. A tick is a host frame callback while
the game runs, or one step of an explicit advance. A clock that ignores the host
timestamp therefore produces the same deltas under both, so the sequence a
validator steps through synchronously is the sequence a reviewer watches play.

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
of losing the overrun on every frame. Pacing against the previous frame's
completion instead would accumulate every overrun for the length of the run.

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
step size: whether an event occurred, which side scored, and the state the
result left behind. Numerical integration of a nonlinear system diverges across
step sizes even when every step of it is correct, so exact positions and
velocities differ legitimately between two correct runs.
