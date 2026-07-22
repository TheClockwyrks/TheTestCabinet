The **Lattice inserter** is the animated swing-arm machine the renderer for
**Lattice** — a deterministic top-down factory simulation — draws for every
inserter tile.

This asset-generation case asks a model to draw it as a **sprite sheet** using
only the drawing tool, one operation at a time: twelve separate 64×64 frames of
one inserter mounted on the centre tile, taking hold of an item on the tile to its
left, swinging across the floor, and releasing it onto the tile to its right, then
swinging back empty. The sprite is item-agnostic — it draws the arm and gripping
hand only, and the renderer draws whatever the machine carries into a slot the
hand leaves clear for it. Drawn flat and top-down — looking down on the machine,
consistent with the assembler, not a side elevation and with no faux-3D height.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the flat top-down viewpoint, the pickup-left → swing-across →
drop-right arc, the reserved item slot at the hand, the hand reading as holding on
the delivery stroke and empty on the return, the base that stays anchored while
only the arm moves, and the seamless loop are what they weigh, and the named
`swing` sequence plays back as a live animation in the review UI.
