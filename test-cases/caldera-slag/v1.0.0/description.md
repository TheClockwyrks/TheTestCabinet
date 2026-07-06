**Caldera Slag** is a lumbering molten elemental — a hunched mass of glowing magma
sheathed in a cracked cooling-basalt crust — for the Caldera hex tower-defense game.
This asset-generation case asks a model to sculpt *and rig* it as a 44×36×44
**skinned** character using only the `sn-skin` tool, one operation at a time: instead
of working from a fixed rig, the model composites **one continuous, whole-body
signed-distance field** into a single smooth, watertight surface, binds it to a
skeleton it invents, and lets the skin **deform across its joints** — an elbow bends
without a seam.

Crucially, the case does **not** hand the model a rig. It fixes only the three
animations the model must author — a lumbering **`advance`** walk, a one-shot **`slam`**
attack, and an **`emerge`** rise from the ground — and leaves the bones, joints, and
per-vertex skin binding that realize them entirely to the model (the skin weights are
derived automatically at render by bone-heat diffusion). So the test measures whether a
model can work out the skeleton a hunched, lumbering creature needs and **deform its one
continuous skin convincingly**: a body that flexes across its joints as it walks, slams,
and emerges, rather than sliding rigid lumps.

The creature must read unmistakably as the Slag — a hunched, top-heavy molten mass on
short planted limbs, glowing magma showing through deep fissures in a near-black basalt
crust — in the disciplined Caldera palette. There is no target model; the model sculpts
and rigs toward a written brief. The recorded operations are regenerated into a skinned,
rigged 3D model the frontend renders and poses by linear-blend skinning, and a reviewer
judges it against the brief: that it reads as a molten creature, and that its one
continuous skin deforms across its joints — without tearing — in each animation.
