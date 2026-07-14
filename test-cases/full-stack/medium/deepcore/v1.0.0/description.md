**Deepcore** is a subterranean dig-and-build game. You are a lone prospector stranded
on **Vhera Deep**, a dead mining world: your dropship is wrecked on the surface and the
only way off the rock is to **build an escape rocket** at the derelict launch pad. You
fabricate the rocket's standard parts at the surface for **Credits** — earned by
**drilling ore out of the ground and selling it** — but the deeper parts need **exotic
materials** that exist only far below, and the last needs an **unstable core sample**
cut from the planet's molten heart and hauled back up before it detonates.

The loop that drives the game is a **fuel-budgeted descent**: digging **down** is cheap
(you drill through a tile and fall through the tunnel you carve), but climbing **back
up** burns **jetpack fuel**, and fuel only refills at the surface. Every trip is a
gamble on depth — go deep enough to reach the richer ore, the two buried materials
(**Resonite** in the rockbed, **Cryenite** in the deepstone, both randomly placed but
guaranteed and found with a **scanner**), and finally the **Core Sample** on its
90-second detonation timer, but keep enough fuel and hull to make it home. Sell ore,
upgrade the fuel tank, drill, cargo, hull, and scanner, and go a little deeper each
time. Gas pockets explode and lava burns; there are **no enemies** — the mine is the
adversary. Two in-game **modes** change only what happens when you die: **Standard**
drops your haul as a retrievable cache and respawns you at the surface, while
**Hardcore** ends the expedition. Winning means fabricating and installing all five
rocket components and **launching**.

Deepcore is also a **full-stack** case: the model under test must **produce the game's
own assets during the run** — above all the **animated miner character** (a suited
prospector with a drill and jetpack, animating distinctly for standing, walking,
drilling, thrusting, falling, taking a hit, and running out of fuel), plus the four
depth-band tiles, the ore and materials, the surface buildings and the escape rocket
that visibly assembles, the particle VFX, and the audio — with the six asset-generation
tools on the run image's `PATH`, and then build the game around them. It is a reskin of
the 2004 Flash mining game Motherload, given an original name, a character in place of
the mining pod, and a rocket-building goal in place of the original's boss fight.
