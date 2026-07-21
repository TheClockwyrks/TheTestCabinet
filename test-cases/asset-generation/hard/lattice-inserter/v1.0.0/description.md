The **Lattice inserter** is the animated swing-arm machine the renderer for
**Lattice** — a deterministic Factorio-style factory simulation — draws for every
inserter tile.

This asset-generation case asks a model to draw it as a **sprite sheet** using
only the drawing tool, one operation at a time: twelve separate 64×64 frames of
one inserter mounted on the centre tile, closing its claw over the tile on its
left, swinging across the floor, and opening its claw over the tile to its right,
then swinging back empty. The sprite is item-agnostic — it draws the arm and claw
only, and the renderer fills the closed grip with whatever item the machine is
carrying. Drawn in Factorio's high-angle pseudo-3D style — looking down on the
machine, consistent with the assembler, not a side elevation — its raised arm
reads from shading and a tracking contact shadow.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the high-angle viewpoint, the pickup-left → swing-across →
drop-right arc, the claw closed on the delivery stroke and open on the return, the
base that stays anchored while only the arm moves, and the seamless loop are what
they weigh, and the named `swing` sequence plays back as a live animation in the
review UI.
