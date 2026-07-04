**Sunfront Sunhawk** is a wide, flat Duneforged **gunship aircraft** with two
spinning rotors and an underslung forward cannon, rendered as an opaque-voxel
model.

This asset-generation case asks a model to sculpt *and rig* it as a 74×28×76
opaque-voxel model using only the `voxel-anim` tool, one operation at a time: it
paints discrete opaque cells to build a broad brass fuselage, a rotor out on each
side, and an iron cannon beneath the nose. Crucially, the case does **not** hand
the model a rig: it fixes only the three animations the model must author — a
self-playing rotor blur **`rotor_spin`**, a playable **`hover`** movement, and a
playable **`strafe`** gun-run — and leaves the parts, joints, and articulation
that realize them entirely to the model.

So the test measures whether a model can work out the pieces a hovering, firing
gunship needs, attach them where they belong, and animate them convincingly:
rotors that whirl on their own, a cannon that sweeps down to rake the ground and
tips back up, a whole craft that bobs as it holds station. There is no target
model: the model sculpts and rigs toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the play-back animations, and a reviewer judges it against
the brief: that it reads as a wide, flat gunship, the cannon aims under `strafe`
without detaching, the rotors spin on their own, the craft hovers, and the hull
holds station while only the intended parts move.
