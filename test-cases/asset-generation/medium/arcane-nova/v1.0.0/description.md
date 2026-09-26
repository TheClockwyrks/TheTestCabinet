**Arcane Nova** is a burst of magic cast once, the flash of energy that erupts
when a spell detonates at a point on the ground. It is a bright white flash at
the center, a thin ring of energy sweeping outward across the ground, a fountain
of glowing rune-spark motes launched upward and arcing back down, and a soft
glow that blooms and fades.

This asset-generation case asks a model to author it as a volumetric
`particle-3d` effect using only the particle tool, one operation at a time. The
model does not place particles; it authors an emitter system:

- a white flash core at the center
- an outward-sweeping cyan-to-violet energy ring on the ground plane
- an upward fountain of pale-violet rune sparks
- a soft violet afterglow

Those are shaped by an outward sweep on the ring, gravity and drag on the
sparks, and a gentle lift on the glow, with color, opacity, and size curves over
each particle's life. The effect is a one-shot cast, one nova's worth, that
bursts at the start and decays cleanly to empty, and the game plays a fresh
instance each time the spell is cast.

The recorded operations emit a `system.json` that the review UI and the game
simulate live. Because the simulation is live and stochastic, the effect varies
slightly from play to play, so a reviewer judges its character across replays
and from multiple orbit angles: its read as an arcane nova, its clean one-shot
decay, and its outward-ring and gravity-arced motion.
