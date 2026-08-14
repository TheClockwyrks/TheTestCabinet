Introduced.

## The render-decoupling requirement no longer contradicts itself

`specs/controls.md` and `specs/instrumentation.md` require the simulation to run
on a fixed timestep **decoupled from rendering**, and then described that
decoupling as "Rendering reads the state, never the other way around." Read as a
constraint on the renderer, the second sentence says the opposite of the first:
it pins what is drawn to whatever the last completed step left behind, tying the
picture to the tick boundary rather than freeing it from one.

The wording now states the requirement only as the one-way dependency it is —
the simulation never reads from, waits on, or is driven by the renderer — and
says nothing about how the renderer presents that state. Nothing was added to
what a build must do: the decoupling requirement is the one that was already
there, and the sentence that could be read against it is gone.

## The reference implementation draws between simulation steps

The simulation runs at 120 Hz and a frame is presented whenever the display asks
for one. The two rates do not divide evenly, so the number of steps that run
between two frames varies, and drawing the raw state moved the fighter, the
drones, and every bullet a different distance each frame — about half a step of
position error, arriving metronomically at the beat frequency between the tick
rate and the refresh rate. It is worst on a 120 Hz display, where one step per
frame is the nominal rate and a single missed step freezes the picture outright
for that frame.

Each step now stamps where the moving objects stood when it began, and the loop
hands the renderer the fraction of the next step the wall clock has already
covered, so it draws between the two. The simulation itself is untouched — the
interpolation state is written by the step and read only by the renderer, never
the other way about — so a given seed and sequence of `step` calls reaches
exactly the state it reached before, and a posed scenario is drawn exactly as it
was stepped.
