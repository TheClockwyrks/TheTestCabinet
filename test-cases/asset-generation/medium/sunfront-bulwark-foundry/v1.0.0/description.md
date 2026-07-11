**Sunfront Bulwark Foundry** is a heavy armored Duneforged bunker-forge with a
raising blast door and a turning drive flywheel.

This asset-generation case asks a model to sculpt *and rig* it as a 66×56×66
opaque-voxel model using only the `voxel-anim` tool, one operation at a time:
instead of a mesh, the model paints discrete opaque cells to build each part, a
squat thick-walled armored body with a broad blast door set into its front and
a great flywheel on its flank.

Crucially, the case does **not** hand the model a rig: it fixes only the two
self-playing animations the model must author — a **`blast_door_raise`** that
lifts and drops the front door along a vertical track and a **`flywheel_spin`**
that turns the flank wheel about its axle — and leaves the parts, joints, and
articulation that realize them entirely to the model, so the test measures
whether a model can work out the pieces a bunker-forge with a raising door and a
turning wheel needs, attach them where they belong, and animate them
convincingly. There is no target model — the model sculpts and rigs toward a
written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the blast door and flywheel cycling on their own
auto-play animations, and a reviewer judges it against the brief: that it reads
as an armored bunker-forge, the door and flywheel cycle on their own, the
building body stays fixed, and the door and wheel stay attached across their
full range of motion.
