**Lattice Assembler** is the 3×3 crafting machine in Lattice, a deterministic
factory simulation — the entity that consumes inputs and counts up crafting ticks
to produce an output. This asset-generation case asks a model to draw it as a
**sprite sheet** using only the drawing tool, one operation at a time: eight
separate 96×96 frames forming a seamless working loop.

Lattice is drawn **flat**: the machine is a clean 2D shape seen straight from
above, with no faux-3D height — no raised top face, no beveled sides, no cast
shadow. Its character comes from what is drawn on it: grey-blue plating, panel
seams, and amber hazard markings. The chassis holds still while a working area
animates, so playing the frames reads as a machine actively making something —
but *how* that is shown is left to the model rather than prescribed.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief: the flat top-down 2D industrial form, whether the loop really
reads as work happening, the strict palette, and the seamless wrap are what they
weigh, and the `craft` sequence plays back as a live animation in the review UI.
