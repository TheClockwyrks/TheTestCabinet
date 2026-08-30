## Overview

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

## Why it is a benchmark

Deepcore's difficulty is one of interacting systems, none of them hard alone.
Digging is cheap and climbing is not, so a descent is a round trip priced in
fuel. Ore has weight, so a rich haul climbs slower, burns more, and past a point
cannot lift at all. The fuel that buys the next descent is bought with the ore
the last one carried home. Get one of those wrong and the economy either cannot
be lost or cannot be won.

The rest of the difficulty is in the details:

- A drill really removes rock. A build whose cut animates without opening the
  tile strands the player at the bottom of a hole they can never leave.
- A side cut begins at the tile edge, not on the keypress, so a miner can move
  laterally inside a tunnel before committing to a dig.
- The ceiling is solid. Height is only ever gained through tunnels already cut.
- The two buried materials are guaranteed to exist and hidden, so the scanner
  has to be the way they are found rather than a hint about them.
- The mine is taller than the viewport, so a camera has to follow the miner down
  the shaft and back up it.

The look is open. Deepcore fixes the geometry, the rates, the prices and the
timings. The palette, the type, the miner's design and the drawing of the mine
are left to the build. What it does fix about appearance is legibility: depth
bands told apart at a glance, ores distinguishable in the rock, and a miner
whose current activity reads from its animation alone.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the
run selects. On an engine run the project also carries the runtime and the
case-owned modules that name every figure the specification fixes and stand the
engine up, and the run writes the game and its debug surface against them. On an
engineless run the project carries no source at all, and the run writes the
runtime as well as the game, its camera transform included.

What it does not receive is a single picture. As a full-stack case, the model
produces the game's own assets during the run. Above all that means the animated
miner, which animates distinctly for standing, walking, drilling, thrusting,
falling, taking a hit, and running out of fuel. It also produces the depth-band
tiles, the ores and materials, the surface buildings, the rocket that visibly
assembles, the particle effects, and the audio. The six asset-generation tools
sit on the run image's `PATH`, and the model builds the game around what it
makes.

Deepcore is a reskin of the 2004 Flash game Motherload, with an original name, a
character in place of the mining pod, and a rocket-building goal in place of the
boss fight.
