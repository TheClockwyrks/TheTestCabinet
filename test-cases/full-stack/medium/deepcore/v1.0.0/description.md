**Deepcore** is a subterranean dig-and-build game. You are a prospector
stranded on Vhera Deep, a dead mining world, and the only way off the rock is to
build an escape rocket at the derelict launch pad. You fabricate the rocket's
parts for Credits, earned by drilling ore and selling it at the surface. The
deeper parts need exotic materials found only far below, and the last needs an
unstable core sample cut from the planet's molten heart and hauled up before it
detonates.

The loop is a fuel-budgeted descent. Digging down is cheap: you drill through a
tile and fall through the tunnel you carve. Climbing back up burns jetpack fuel,
bought with Credits at the surface. An empty climb is fast, but ore has weight,
and a rich, heavy haul climbs slowly, burns far more fuel, and cannot lift at all
if it outweighs your jetpack until you drop some ore or upgrade. Every trip is a
gamble on depth: go deep enough to reach richer ore, rarer gemstones, the two
buried materials (Resonite and Cryenite, located with a scanner), and finally
the Core Sample on its 90-second timer, but keep enough fuel and hull to make it
home.

The mine itself is the only adversary; there are no enemies. Gas pockets hide in
the dirt and explode harder the deeper you go, countered by hull. Lava burns on
contact and can be drilled only at a hull cost the radiator blunts. Unbreakable
boulders must be dug around. Sell ore to upgrade the fuel tank, drill, cargo
bay, hull, jetpack, radiator, and scanner; save at the surface Save Pad; and go
a little deeper each run. Two modes change only what death costs: Standard
restores your last save, while Hardcore ends the expedition. A world size chosen
at the start (Quick, Standard, or Marathon) scales only how deep the mine goes.
You win by fabricating all five rocket components and launching.

As a full-stack case, the model under test produces the game's own assets during
the run. Above all that means the animated miner character, which animates
distinctly for standing, walking, drilling, thrusting, falling, taking a hit,
and running out of fuel. It also produces the depth-band tiles, the ores and
materials, the surface buildings, the rocket that visibly assembles, the
particle VFX, and the audio. The six asset-generation tools sit on the run
image's `PATH`, and the model builds the game around what it makes. Deepcore is
a reskin of the 2004 Flash game Motherload, with an original name, a character
in place of the mining pod, and a rocket-building goal in place of the boss
fight.
