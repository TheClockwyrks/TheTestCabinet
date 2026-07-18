**Lattice Items** is the icon set for the items that ride the belts in
**Lattice**, a deterministic grid-based factory simulation. This
asset-generation case asks a model to draw it as a **sprite sheet** using only
the drawing tool, one operation at a time: seven separate 16×16 frames, one
distinct item per frame — iron and copper ore; iron and copper plate; an iron
gear wheel; a coil of copper cable; and an electronic circuit.

The seven are exactly the items the simulation carries, in the order it lists
them, so a frame index is an item identity rather than a step in an animation.

Because belt items render at roughly half a tile, each icon must read
unmistakably at this tiny size from silhouette and color alone.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: that every frame reads as its named item, that the seven are
mutually distinguishable — including the copper plate and copper cable, which
share a palette and differ only in shape — and that a consistent outline,
lighting, and palette bind them into one cohesive family. A single slow showcase
sequence flips through all seven in order in the review UI so the set can be
judged as a whole.
