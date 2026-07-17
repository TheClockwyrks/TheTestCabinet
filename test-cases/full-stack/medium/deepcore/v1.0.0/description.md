**Deepcore** is a subterranean dig-and-build game. You are a lone prospector stranded
on **Vhera Deep**, a dead mining world: your dropship is wrecked on the surface and the
only way off the rock is to **build an escape rocket** at the derelict launch pad. You
fabricate the rocket's standard parts at the surface for **Credits** — earned by
**drilling ore out of the ground and selling it** — but the deeper parts need **exotic
materials** that exist only far below, and the last needs an **unstable core sample**
cut from the planet's molten heart and hauled back up before it detonates.

The loop that drives the game is a **fuel-budgeted descent**: digging **down** is cheap
(you drill through a tile and fall through the tunnel you carve), but climbing **back
up** burns **jetpack fuel**, which is **bought** with Credits at the surface (never
free). An **empty** climb is fast and cheap, but the cargo bay holds a fixed number of
**ore slots** and ore also has **weight** the jetpack must lift: a rich, heavy haul climbs
slowly, burns far more fuel, and — if it outweighs the jetpack — cannot lift at all until
you open the **inventory** and **drop** some ore or upgrade. Every trip is a gamble on
depth — go deep enough to reach the richer, heavier ore and the rarer **gemstones** each
band hides, the two buried materials (**Resonite** in the rockbed, **Cryenite** in the
deepstone, both randomly placed
but guaranteed and found with a **scanner**), and finally the **Core Sample** on its
90-second detonation timer, but keep enough fuel and hull to make it home. Sell ore, upgrade
the fuel tank, drill, cargo bay, hull, **jetpack**, **radiator**, and scanner, save the run
at the surface **Save Pad**, and go a little deeper each time. The mine is wider than the
screen and scrolls both ways, so the whole width is never in view at once — the scanner
earns its keep. **Gas pockets** are hidden in the dirt (only a faint seep gives them
away) and explode harder the deeper you go; **lava** burns on contact; **unbreakable
stone** boulders block the drill and must be dug around (a **radiator** blunts gas and
lava). There are **no enemies** — the mine is the adversary. Two in-game **modes** change
only what happens when you die: **Standard** lets you **restore from your last save**,
while **Hardcore** deletes the save and ends the expedition. A **world size** chosen at the
start — **Quick** (half-depth), **Standard**, or **Marathon** (double-depth) — scales only
how deep the mine goes, for a shorter or longer dig through the same game. Winning means
fabricating and installing all five rocket components and **launching**.

Deepcore is also a **full-stack** case: the model under test must **produce the game's
own assets during the run** — above all the **animated miner character** (a suited
prospector with a drill and jetpack, animating distinctly for standing, walking,
drilling, thrusting, falling, taking a hit, and running out of fuel), plus the four
depth-band tiles, the ore and materials, the surface buildings and the escape rocket
that visibly assembles, the particle VFX, and the audio — with the six asset-generation
tools on the run image's `PATH`, and then build the game around them. It is a reskin of
the 2004 Flash mining game Motherload, given an original name, a character in place of
the mining pod, and a rocket-building goal in place of the original's boss fight.
