**Explosion Burst** is a generic action-game explosion — the burst a game plays
whenever something detonates: a shell impact, a fuel barrel, a grenade, a destroyed
vehicle. A blinding overexposed flash, a fast-expanding ball of fire that cools to
smoke, a radial spray of hot sparks thrown out in every direction, and a dark puff
of smoke that rises and fades.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — an overexposed white flash core
at the center, a fireball that swells and cools from hot orange toward dark smoke, a
radial burst of hot-orange spark streaks stretched along their velocity, and a
lingering dark smoke puff — shaped by a radial outward burst, drag, a light gravity,
and the smoke's buoyancy, with color, opacity, and size curves over each particle's
life. It is a **one-shot** burst that fires hard at the start and decays cleanly to
empty; the game plays a fresh instance once per detonation. The recorded operations
emit a `system.json` that the review UI and the game **simulate live**; because it is
a live, stochastic simulation it varies slightly from play to play, so a reviewer
judges the effect's character — its read as an explosion, its clean one-shot decay,
and its radial outward motion — across replays and from multiple orbit angles, not a
frozen frame.
