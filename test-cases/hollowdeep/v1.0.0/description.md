**Hollowdeep** is a side-view sealed-colony survival simulation. You look at a
cross-section of a sealed underground and keep a small crew of colonists — the
**delvers** — alive by digging into the earth, mining ore, and building the machines
and farms that make the dug-out space survivable.

Its defining pressure is the **air economy**. The colony opens with a finite pocket of
breathable oxygen; the delvers breathe it and exhale CO2, and both gases diffuse
through the open space you dig and settle by weight — oxygen rising, CO2 pooling in the
low tunnels. Left alone the pocket sours and the crew suffocates, so survival is a race
to stand up powered oxygen generation and a food source before the starting air runs
out, then to hold a growing colony's air, power, and food in balance. Underneath sit
several interacting systems: a dig-able tile world, the two-gas simulation, a power
network of generators/wires/machines, needs-driven delvers who pathfind and work a job
queue, and a refine→build→farm economy.

Hollowdeep is also the **flagship full-stack case**: the model under test must
**produce the game's own assets during the run** — the delver sprite sheets, the tile
and machine sprites, the gas and dust particle overlays, and the sound and music — with
the six asset-generation tools on the run image's `PATH`, and then build the game
around them. It is inspired by colony survival sims like *Oxygen Not Included* but is
entirely its own: an original name, look, and system set, and its own scope.
