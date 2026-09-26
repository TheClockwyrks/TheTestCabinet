**Sunfront Lumen** is a floating Duneforged beacon drone with two
counter-rotating rings around a glowing core.

This asset-generation case asks a model to sculpt and rig it as a 20×26×20
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: a
hovering brass core carrying a solar-hot heart, two iron rings orbiting it, and
a beam emitter projecting from the core face.

The case fixes only the three animations the model must author: a self-playing
`ring_spin` with the rings counter-rotating on their own, a `hover` that bobs
the whole legless craft in place, and a `pulse` that nods the front emitter up
and down. The parts, joints, and articulation that realize them are the model's
to invent, so the case measures whether a model can work out the pieces a
hovering, ring-spinning, beam-nodding drone needs, attach them where they
belong, and animate them convincingly. There is no target model: the model
sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the play-back animations. A reviewer judges it against
the brief: that it reads as a floating beacon drone, the emitter nods on its
mount without detaching, the rings spin on their own in opposite directions,
the craft hovers with weight, and only the moving parts move.
