Introduced.

## The round trip out of a drilled shaft is checked

`movement.drill-down` proves one tile: hold down over rock, watch the miner sink into
it, and see that tile become open tunnel. Everything after it is teleported where it
needs to be, so nothing ever asked the one question the whole loop rests on — having dug
a hole, can the miner get back out of it?

Two defects lived in that gap, and both leave a build that looks right on screen. A
drill that animates and reports progress but never removes the rock: the miner appears to
descend while the grid behind it stays solid, so a single-tile cut can still read
correctly while nothing is really being mined. And a shaft the miner cannot climb —
collision resolved against the pre-drill grid, a carved tunnel narrower than the miner's
box, a lip it snags on — which strands the player at the bottom of their own dig and
makes the game unwinnable however good the descent looks.

`movement.climb-after-drill` cuts three rows of solid rock straight down, checks that
each one really became open tunnel, and then holds thrust and confirms the miner rides
the jetpack back up to the row it set out from, with fuel to spare and without ever
cutting upward. Two mutants of the reference implementation fix what it is worth: one
that completes each cut without clearing the tile, and one that refuses the miner any
upward velocity below the surface. The first also fails `movement.drill-down`, which owns
that tile; the second fails nothing else in the category — `drill-down` and `sky-open`
both pass a build that digs a hole it can never leave.

## Where a run begins is checked

Every other movement item teleports the miner to the situation it wants, and
`presentation.buildings-placed` reads the surface ground line off the miner's own feet at
spawn — so no check ever looked at where a fresh expedition actually starts. A build could
open the camp onto a pre-dug shaft, or generate a tunnel under the spawn column, and begin
the player underground or dropping into a hole, with every verdict unmoved.

`specs/world.md` puts the camp on `row 0`, "where the miner spawns and returns to between
digs", and `specs/gameplay.md` opens the loop with "the miner starts on the surface".
`movement.spawn-on-surface` holds a build to it: three fresh expeditions, each generating
its own mine, are started and then left alone for a second with nothing held. Each must
begin at the surface with the shallow rows under the spawn column unmined, and must still
be standing there after that second, never having descended. Three seeds rather than one
because the mine is generated per game — a hole that only opens under the camp on some
seeds is still a run that begins by falling down it.

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

The simulation runs at 60 Hz and a frame is presented whenever the display asks
for one. The two rates do not divide evenly, so the number of steps that run
between two frames varies, and drawing the raw state moved the miner, and with
it the camera and so the whole mine drawn relative to it a different distance
each frame — about half a step of position error, arriving metronomically at the
beat frequency between the tick rate and the refresh rate. At 60 Hz on a 60 Hz
display one step per frame is the nominal rate, so a single missed step freezes
the picture outright for that frame. The camera matters as much as the miner
here: everything is drawn relative to it, so a camera that snapped step to step
juddered the entire view at once.

Each step now stamps where the moving objects stood when it began, and the loop
hands the renderer the fraction of the next step the wall clock has already
covered, so it draws between the two. The simulation itself is untouched — the
interpolation state is written by the step and read only by the renderer, never
the other way about — so a given seed and sequence of `step` calls reaches
exactly the state it reached before, and a posed scenario is drawn exactly as it
was stepped.
