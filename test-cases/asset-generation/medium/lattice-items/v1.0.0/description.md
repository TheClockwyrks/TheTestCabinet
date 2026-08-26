**Lattice Items** is the icon set for the items that ride the belts in Lattice,
a deterministic grid-based factory simulation. This asset-generation case asks a
model to draw it as a sprite sheet using only the drawing tool, one operation at
a time. The sheet is seven separate 32×32 frames, one distinct item per frame:
iron and copper ore, iron and copper plate, an iron gear wheel, a coil of copper
cable, and an electronic circuit.

The seven are not an animation: each is a separate static icon. They are exactly
the items the simulation carries, in the order it lists them, so a frame index
is an item identity.

A belt item is sub-tile in the world, roughly half a tile, and each icon is
authored at 32×32 so there is enough resolution to read small items like the
gear. Each must still read unmistakably from silhouette and color alone.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief. They weigh whether every frame reads as its named item,
whether the seven are mutually distinguishable, and whether a consistent
outline, lighting, and palette bind them into one cohesive family. The copper
plate and the copper cable share a palette and differ only in shape. A single
slow showcase sequence flips through all seven in order in the review UI so the
set can be judged as a whole.
