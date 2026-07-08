**Sunfront Rail-Lance Muzzle Flash** is the muzzle flash from *Sunfront*, a
real-time tug-of-war of solar-powered war automatons — the thin, searing energy
discharge that flares from the tip of a rail-lance, the long-range piercing weapon
of the game's marksman unit.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — a searing white-gold discharge
core at the lance tip, a thin streaked forward bolt of energy, and a flicker of
crackle motes, with no smoke or flame, shaped by forward projection, light drag, and
a velocity stretch on the bolt, with color, opacity, and size curves over each
particle's life. Unlike a one-shot explosion, the effect **loops**: it plays
continuously while a unit fires, settling into a repeating discharge rather than
decaying to empty. The recorded operations emit a `system.json` that the review UI
and the game **simulate live**; because it is a live, stochastic simulation it
varies slightly from play to play, so a reviewer judges the effect's character — its
read as a focused energy discharge, its continuous loop, and its thin forward bolt —
across replays and from multiple orbit angles, not a frozen frame.
