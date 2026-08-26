**Hollowdeep** is a side-view sealed-colony survival simulation. You look at a
cross-section of a sealed underground and keep a small crew of colonists called
delvers alive by digging into the earth, mining ore, and building the machines
and farms that make the dug-out space survivable.

Its defining pressure is the air economy. The colony opens with a finite pocket
of breathable oxygen. The delvers breathe it and exhale CO2, and both gases
diffuse through the open space you dig and settle by weight: oxygen rises and
CO2 pools in the low tunnels. Left alone the pocket sours and the crew
suffocates, so survival is a race to stand up powered oxygen generation and a
food source before the starting air runs out, then to hold a growing colony's
air, power, and food in balance. Underneath sit several interacting systems: a
dig-able tile world, the two-gas simulation, a power network of
generators/wires/machines, needs-driven delvers who pathfind and work a job
queue, and a refine→build→farm economy.

Hollowdeep is the flagship full-stack case. The model under test produces the
game's own assets during the run with the six asset-generation tools on the run
image's `PATH`: the delver sprite sheets, the tile and machine sprites, the gas
and dust particle overlays, and the sound and music. It then builds the game
around them. The case is inspired by colony survival sims, notably *Oxygen Not
Included*; its name, look, system set, and scope are original.
