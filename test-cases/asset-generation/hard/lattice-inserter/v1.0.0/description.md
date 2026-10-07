The **Lattice inserter** is the animated swing-arm machine the renderer for
Lattice, a deterministic top-down factory simulation, draws for every inserter
tile. It comes in three upgrade tiers: a base machine, a faster reinforced
machine, and the fastest, most advanced machine.

This asset-generation case asks a model to draw all three as a sprite sheet
using only the drawing tool, one operation at a time: for each tier, twelve
separate 64×64 frames of one inserter mounted on the centre tile, taking hold of
an item on the tile to its left, swinging across the floor, releasing it onto
the tile to its right, then swinging back empty. That is thirty-six frames in
all. The sprite is item-agnostic, drawing the arm and gripping hand only, and
the renderer draws whatever the machine carries into a slot the hand leaves
clear for it. It is drawn flat and top-down, looking down on the machine,
consistent with the assembler. It is not a side elevation and has no faux-3D
height.

What makes this one case rather than three is that all three tiers have to read
as one inserter progressively upgraded. They share the same grey-blue pivot
base, reach, item slot, and swing arc, and differ only in their arm accent color
(amber, then red-orange, then blue-cyan), their rising mechanical detail (a
secondary strut, a sturdier gripper, a subtle energy glow), and their swing's
playback speed. A higher tier is unmistakably the same machine, only faster and
more refined.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief. The heaviest weight goes to the family properties: each tier
told apart at a glance, all three reading as one inserter, and a higher tier
still unmistakably the same machine. They also weigh:

- the flat top-down viewpoint
- the pickup-left → swing-across → drop-right arc
- the reserved item slot at the hand
- the hand reading as holding on the delivery stroke and empty on the return
- the base staying anchored while only the arm moves
- the seamless loop

The `swing-t1`, `swing-t2`, and `swing-t3` sequences play back as live
animations in the review UI, each at its tier's rate, so the rising speed reads
directly.
