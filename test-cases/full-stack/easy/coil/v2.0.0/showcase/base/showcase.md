Coil is a neon grid serpent. The snake never stops: it traces one unbroken line
across a bordered board, and every pellet it swallows adds a cell to its tail.
Exactly one pellet is on the board at a time, and the only thing that ever kills
you is the line you have already drawn across it.

What makes this a scoring game rather than a survival one is the combo. Every
pellet opens a window of three and a half seconds. Eat the next one before that
window closes and the multiplier climbs a step, to a cap of five, and the window
reopens full; let it run out and the multiplier drops straight back to one. A
pellet is worth ten points times whatever the multiplier is when it goes down, so
the gap between a careful player and a fast one is the entire score.

The snake covers one cell per tick and the game ticks eight times a second, which
is the currency the window is spent in: a full window is twenty-eight ticks, and
twenty-eight ticks is twenty-eight cells of travel. A pellet on the far side of
the board is therefore right at the edge of what the multiplier survives. Every
eat is a route problem, and the answer keeps changing, because the body you have
to steer around is one cell longer each time.

Classic plays it on the open board: nothing between the head and the pellet but
the walls and the coil already behind you. Turns land on the grid and a turn is
only ever a quarter, so the head can never double back into its own neck — which
means a route that looks short is often a route that shuts a door behind it.

The clip is the reference implementation played from the title screen: half a
minute of one real round, thirteen pellets taken, the multiplier walked up to
`x5` and held there across eight of them, then a window let go by a cell too many
and the bar draining out from under it before the run is rebuilt.
