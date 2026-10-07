**Explosion Burst** is a generic action-game explosion, the burst a game plays
whenever something detonates: a shell impact, a fuel barrel, a grenade, a
destroyed vehicle. It is a blinding overexposed flash, a fast-expanding ball of
fire that cools to smoke, a radial spray of hot sparks thrown out in every
direction, and a dark puff of smoke that rises and fades.

This asset-generation case asks a model to author it as a volumetric
`particle-3d` effect using only the particle tool, one operation at a time. The
model builds an emitter system: an overexposed white flash core at the center, a
fireball that swells and cools from hot orange toward dark smoke, a radial burst
of hot-orange spark streaks stretched along their velocity, and a lingering dark
smoke puff. A radial outward burst, drag, a light gravity, and the smoke's
buoyancy shape the motion, and color, opacity, and size curves run over each
particle's life.

The burst is one-shot: it fires hard at the start and decays cleanly to empty,
and the game plays a fresh instance once per detonation. The recorded operations
emit a `system.json` that the review UI and the game simulate live. That
simulation is stochastic, so the effect varies slightly from play to play. A
reviewer judges the effect's character across replays and from multiple orbit
angles: its read as an explosion, its clean one-shot decay, and its radial
outward motion.
