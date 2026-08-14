## The render-decoupling requirement no longer contradicts itself

`specs/simulation.md` and `specs/instrumentation.md` require the simulation to
run on a fixed timestep **decoupled from rendering**, and then described that
decoupling as "rendering reads the state rather than driving it" and "Rendering
reads the state, never the other way around." Read as constraints on the
renderer, those sentences say the opposite of the requirement they follow: they
pin what is drawn to whatever the last completed step left behind, tying the
picture to the tick boundary rather than freeing it from one.

The wording now states the requirement only as the one-way dependency it is —
the simulation never reads from, waits on, or is driven by the renderer — and
says nothing about how the renderer presents that state. Nothing was added to
what a build must do: the decoupling requirement is the one that was already
there, and the sentences that could be read against it are gone.

## The reference implementation draws between simulation steps

The simulation runs at 120 Hz and a frame is presented whenever the display asks
for one. The two rates do not divide evenly, so the number of steps that run
between two frames varies, and drawing the raw state moved the ship, the rocks,
the bullets and the saucer a different distance each frame — about half a step
of position error, arriving metronomically at the beat frequency between the
tick rate and the refresh rate. It is worst on a 120 Hz display, where one step
per frame is the nominal rate and a single missed step freezes the picture
outright for that frame.

Each step now stamps where each body stood when it began, and the loop hands the
renderer the fraction of the next step the wall clock has already covered, so it
draws between the two. The field is a torus, so a body crossing a seam carries
its interpolation window across with it: the wrap relabels a position rather
than moving the body, and the window has to span the one step of real motion
instead of a jump back across the whole field. A bullet's comet is cut at a seam
exactly as before.

The simulation itself is untouched — the interpolation state is written by the
step and read only by the renderer, never the other way about — so a given seed
and sequence of `step` calls reaches exactly the state it reached before, and a
posed scenario is drawn exactly as it was stepped.

## Scoring

The checklist is unchanged from `v2.0.1`: no item was added, removed or
re-weighted, and no `id`, `weight`, `domain`, `reference`, `proof`, or validation
script moved, so scores remain directly comparable across the bump. The only
seeded change is the rewording above, which withdraws sentences that could be
read against a requirement already stated elsewhere rather than asking for
anything new.
