**Lattice Assembler** is the 3×3 crafting machine in Lattice, a deterministic
factory simulation. It consumes inputs and counts up crafting ticks to produce
an output, and it comes in three upgrade tiers: a base machine, a faster
reinforced machine, and the fastest, most advanced machine. This
asset-generation case asks a model to draw all three as one sprite sheet using
only the drawing tool, one operation at a time: three eight-frame seamless
working loops across twenty-four separate 96×96 frames.

Lattice is drawn flat. The machine is a clean 2D shape seen straight from above,
with no faux-3D height: no raised top face, no beveled sides, no cast shadow.
Its character comes from what is drawn on it, namely grey-blue plating, panel
seams, and hazard markings. The chassis holds still while a working area
animates, so playing a tier's frames reads as a machine actively making
something. The model chooses how that is shown.

What makes this one case rather than three is that all three tiers have to read
as one assembler progressively upgraded. They share the same grey-blue chassis,
3×3 footprint, silhouette, and teal working state. What separates them is their
hazard accent color, amber then red-orange then blue; their rising mechanical
detail, plain then reinforced then densely plated with a subtle energy glow; and
the playback speed of their loop. A higher tier is unmistakably the same
machine, only faster and more refined.

The recorded operations are regenerated into each frame, which a reviewer judges
against the brief. The family properties carry the heaviest weight: each tier
told apart at a glance, all three reading as one machine, and a higher tier
still unmistakably the same assembler. Alongside those they weigh the flat
top-down 2D industrial form, whether each loop really reads as work happening,
the strict palette, and the seamless wrap. The `craft-t1`, `craft-t2`, and
`craft-t3` sequences play back as live animations in the review UI, each at its
tier's rate, so the rising speed reads directly.
