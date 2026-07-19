# The expedition: the campaign start

This is the single expedition Deepcore plays, and its main-menu entry. It builds on the
mine (`specs/world.md`), the miner (`specs/character.md`), the economy and states
(`specs/flow.md`), the rocket (`specs/rocket.md`), and the two modes (`specs/modes.md`).

## Main-menu entry

The title menu lists exactly one play action, `NEW EXPEDITION`, followed by HOW TO PLAY
(`specs/flow.md`, Game states). Choosing `NEW EXPEDITION` does not start a game directly:
it opens the mode select menu (`specs/modes.md`), where the player picks Standard or
Hardcore; that leads to the world size select (`specs/world.md`, `specs/flow.md`), Quick,
Standard, or Marathon, and choosing a size begins the expedition in the picked mode at
the picked size.

## The expedition

There is one expedition, played the same way every time (the mine is generated per game
within the fixed rules of `specs/world.md`, at the chosen world size, which scales only
how deep the dig is, not the systems, values, or goal). The miner starts on the surface
with tier-1 gear on every upgrade track (`specs/upgrades.md`), `0` Credits, an empty
cargo, and an empty rocket (`specs/rocket.md`), and:

- digs down through the four bands, selling ore for Credits and buying upgrades
  (`specs/mining.md`, `specs/upgrades.md`);
- mines the two buried exotic materials (Resonite in the rockbed, Cryenite in the
  deepstone) with the scanner's help (`specs/mining.md`);
- makes the core run to extract the unstable Core Sample and haul it up inside its
  90-second timer (`specs/hazards.md`);
- fabricates all five rocket components and launches to win (`specs/rocket.md`).

The chosen mode (`specs/modes.md`) governs only what happens on death. Everything else
(the world, the economy, the hazards, the goal) is identical across modes and across
runs. PLAY AGAIN on an end screen replays a fresh expedition in the same mode and world
size.
