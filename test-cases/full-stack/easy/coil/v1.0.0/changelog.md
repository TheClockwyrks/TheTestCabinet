Introduced.

## The render-decoupling requirement no longer contradicts itself

`specs/instrumentation.md` requires the simulation to run on a fixed timestep
**decoupled from rendering**, and then described that decoupling as "Rendering
reads the state, never the other way around." Read as a constraint on the
renderer, the second sentence says the opposite of the first: it pins what is
drawn to whatever the last completed step left behind, tying the picture to the
tick boundary rather than freeing it from one.

The wording now states the requirement only as the one-way dependency it is —
the simulation never reads from, waits on, or is driven by the renderer — and
says nothing about how the renderer presents that state. Nothing was added to
what a build must do: the decoupling requirement is the one that was already
there, and the sentence that could be read against it is gone.

The reference implementation needed no matching change. The snake advances
exactly one cell per tick at 8 ticks a second and is drawn on the cell grid in
nearest-neighbor pixel art, so its motion is cell-snapped by design
(`specs/board.md`, `specs/combo.md`); drawing it between cells would fight the
look the case asks for rather than improve it.
