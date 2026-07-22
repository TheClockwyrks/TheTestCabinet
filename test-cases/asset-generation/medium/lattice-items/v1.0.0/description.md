**Lattice Items** is the icon set for the inventory of **Lattice**, a deterministic
grid-based factory simulation. This asset-generation case asks a model to draw it as
a **sprite sheet** using only the drawing tool, one operation at a time: sixteen
separate 32×32 frames across two groups.

Frames 0–6 are the **seven base materials** that ride the belts — iron and copper
ore; iron and copper plate; an iron gear wheel; a coil of copper cable; and an
electronic circuit. Frames 7–15 are the **nine placeable machines**: a belt, an
assembler, and an inserter, each drawn in **three tiers**, so every tier is its own
inventory icon. A machine's **type** is read from its silhouette and its **tier**
from a shared accent convention — amber for tier 1, red for tier 2, cyan for tier 3,
with detail rising across the three.

The frame order is fixed, so a frame index is an item identity rather than a step in
an animation. Each icon is authored at 32×32 so there is enough resolution to read
small details — the gear's teeth, a belt's chevrons, an inserter's claw — and each
must still read unmistakably from silhouette and color alone.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: that every frame reads as its named item, that each machine's
three tiers are told apart at a glance by accent and rising complexity while sharing
one silhouette, that the three machine types are unmistakable from one another, and
that a consistent outline, lighting, and palette family bind all sixteen — base
materials and machines alike — into one cohesive set. A single slow showcase sequence
flips through all sixteen in order in the review UI so the set can be judged as a
whole.
