**Arcane Nova** is a burst of magic cast once — the flash of energy that erupts when
a spell detonates at a point on the ground: a bright white flash at the center, a
thin ring of energy sweeping outward across the ground, a fountain of glowing
rune-spark motes launched upward and arcing back down, and a soft glow that blooms
and fades.

This asset-generation case asks a model to author it as a volumetric `particle-3d`
effect using only the particle tool, one operation at a time: not by placing
particles, but by authoring an **emitter system** — a white flash core at the center,
an outward-sweeping cyan-to-violet energy ring on the ground plane, an upward
fountain of pale-violet rune sparks, and a soft violet afterglow, shaped by an
outward sweep on the ring, gravity and drag on the sparks, and a gentle lift on the
glow, with color, opacity, and size curves over each particle's life. It is a
**one-shot** cast — one nova's worth — that bursts at the start and decays cleanly to
empty; the game plays a fresh instance each time the spell is cast. The recorded
operations emit a `system.json` that the review UI and the game **simulate live**;
because it is a live, stochastic simulation it varies slightly from play to play, so a
reviewer judges the effect's character — its read as an arcane nova, its clean
one-shot decay, and its outward-ring and gravity-arced motion — across replays and
from multiple orbit angles, not a frozen frame.
