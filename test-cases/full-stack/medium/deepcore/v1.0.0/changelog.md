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
