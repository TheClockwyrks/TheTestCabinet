**Caldera Slag** is a lumbering molten elemental for the Caldera hex tower-defense
game: a hunched mass of glowing magma sheathed in a cracked cooling-basalt crust.

This asset-generation case asks a model to sculpt and rig it as a 44×36×44 skinned
character using only the `sn-skin` tool, one operation at a time. The model
composites one continuous, whole-body signed-distance field into a single smooth,
watertight surface, binds it to a skeleton it invents, and lets the skin deform
across its joints, so an elbow bends without a seam. The case fixes the three
animations the model must author: a lumbering `advance` walk, a one-shot `slam`
attack, and an `emerge` rise from the ground. The bones,
joints, and per-vertex skin binding that realize them are the model's to invent,
and the skin weights are derived automatically at render by bone-heat diffusion.
The test therefore measures whether a model can work out the skeleton a hunched,
lumbering creature needs and deform its one continuous skin convincingly, with a
body that flexes across its joints as it walks, slams, and emerges.

The creature must read unmistakably as the Slag in the disciplined Caldera
palette: a hunched, top-heavy molten mass on short planted limbs, glowing magma
showing through deep fissures in a near-black basalt crust. There is no target
model; the model sculpts and rigs toward a written brief. The recorded operations
are regenerated into a skinned, rigged 3D model the frontend renders and poses by
linear-blend skinning, and a reviewer judges it against the brief: that it reads
as a molten creature, and that its one continuous skin deforms across its joints,
without tearing, in each animation.
