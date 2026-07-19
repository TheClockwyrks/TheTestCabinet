Introduced. A full-stack take on the neon grid-serpent arcade game: the build
produces the snake's own sprite set — an animated head that bites when it eats,
plus straight-body, corner, and tail sprites that render the snake turning — and
the game's sound and music with the asset-generation tools on the run image's
`PATH`, then ships them across two variants, each its own mode: a base Classic run
on the open board, and a Maze run on a board laced with a fixed course of fatal
interior obstacles to thread.

The build also exposes a debugging and automation surface — a deterministic,
fixed-tick, render-free core, a `window.__coil` API to drive and inspect the game
from code, and a read-only debug overlay (`specs/instrumentation.md`) — so a run's
mechanics can be driven into exact scenarios and checked automatically. The
specification is organized by concern (`overview`, `board`, `movement`, `combo`,
`interface`, `assets`, `instrumentation`, and a per-variant `mode` spec).
