**Sunfront Lumen** is a floating Duneforged beacon drone with two
counter-rotating rings around a glowing core. This asset-generation case asks a
model to sculpt *and rig* it as a 40×56×40 opaque-voxel model using only the
`voxel-anim` tool, one operation at a time: a hovering brass core carrying a
solar-hot heart (the fixed root), two iron rings orbiting it, and a beam emitter
projecting from the core face. The rig's required, game-facing contract is a
caller-driven **`emitter_pitch`** joint — a rotation that tilts the front beam
projector up and down about its mount — while the two rings spin on their own
through the auto-driven **`ring_left_spin`** and **`ring_right_spin`** joints,
turning in opposite directions. There is no target model — the model sculpts and
rigs toward a written brief, and may add its own extra parts and joints on top.
The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with a live `emitter_pitch` control and a `pulse` animation, and
a reviewer judges it against the brief: that it reads as a floating beacon drone,
the emitter tilts on the correct hinge without detaching, the core stays fixed,
and the rings and emitter stay attached are what they weigh.
