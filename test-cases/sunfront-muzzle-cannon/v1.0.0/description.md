**Sunfront Heavy-Cannon Muzzle Flash** is the muzzle blast from *Sunfront*, a
real-time tug-of-war of solar-powered war automatons — the big, smoky blast that
belches from the barrel of a heavy cannon or mortar as one of the game's artillery
and capstone units fires.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — a big white-hot blast core at
the muzzle, a forward gout of orange flame and heavy embers, and a thick rolling
grey-black smoke plume, shaped by forward projection, drag, gravity, and the smoke's
buoyancy, with color, opacity, and size curves over each particle's life. Unlike a
one-shot explosion, the effect **loops**: it plays continuously while a unit fires,
settling into a heavy firing rhythm rather than decaying to empty. The recorded
operations emit a `system.json` that the review UI and the game **simulate live**;
because it is a live, stochastic simulation it varies slightly from play to play, so
a reviewer judges the effect's character — its read as a heavy-cannon blast, its
continuous loop, and its forward-directed motion with weight — across replays and
from multiple orbit angles, not a frozen frame.
