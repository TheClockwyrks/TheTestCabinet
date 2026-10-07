**Lattice Items** is the icon set for the inventory of Lattice, a deterministic
grid-based factory simulation. This asset-generation case asks a model to draw
it as a sprite sheet using only the drawing tool, one operation at a time. The
sheet is seventeen separate 32×32 frames, one distinct item per frame, across
two groups.

Frames 0–6 are seven of the eight base materials that ride the belts: iron and
copper ore, iron and copper plate, an iron gear wheel, a coil of copper cable,
and an electronic circuit. Frames 7–15 are the nine placeable machines — a
belt, an assembler, and an inserter, each drawn in three tiers, so every tier
is its own inventory icon. The eighth base material, coal, sits at frame 16
rather than among the other materials, because the frame order is fixed and
coal was added to the set last, after the machines already held frames 7–15. A
machine's type is read from its silhouette and its tier from a shared accent
convention: amber for tier 1, red for tier 2, cyan for tier 3, with detail
rising across the three.

The seventeen are not an animation: each is a separate static icon. The frame
order mirrors the simulation's canonical item table one for one, so a frame
index is an item identity.

The base materials are sub-tile in the world, roughly half a tile, and every
icon is nonetheless authored at a full 32×32 so there is enough resolution to
read small details like the gear's teeth, a belt's chevrons, or an inserter's
claw. Each must still read unmistakably from silhouette and color alone.

The recorded operations are regenerated into each frame, which a reviewer
judges against the brief. They weigh whether every frame reads as its named
item, whether the base materials are mutually distinguishable, whether each
machine's three tiers are told apart at a glance by accent and rising
complexity while sharing one silhouette, whether the three machine types are
unmistakable from one another, and whether a consistent outline, lighting, and
palette family bind all seventeen — base materials and machines alike — into
one cohesive set. The copper plate and the copper cable share a palette and
differ only in shape. A single slow showcase sequence flips through all
seventeen in order in the review UI so the set can be judged as a whole.
