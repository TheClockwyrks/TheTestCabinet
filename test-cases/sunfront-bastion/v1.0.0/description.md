**Sunfront Bastion** is a huge Duneforged home keep with a rotating solar
collector crown, a raising gate, and a slowly turning beacon.

This asset-generation case asks a model to sculpt *and rig* it as a 72×88×72
opaque-voxel model using only the `voxel-anim` tool, one operation at a time:
instead of a smoothed surface, the model **paints discrete opaque cells** into
a massive brass masonry fortress — thick ramparts, corner towers, and a central
spire — with a collector crown ringing its summit, a gate in its front wall,
and a beacon atop its spire.

Crucially, the case does **not** hand the model a rig: it fixes only the three
self-playing animations the model must author — a **`crown_spin`** that turns
the crown, a **`gate_raise`** that lifts the gate up and back down, and a
**`beacon_spin`** that slowly turns the beacon — and leaves the parts, joints,
and articulation that realize them entirely to the model, so the test measures
whether a model can work out the pieces such a keep needs, attach them where
they belong, and animate them convincingly (a crown that rings the summit and
turns cleanly, a gate that slides up and down within its opening, a beacon that
sweeps atop the spire). There is no target model — the model sculpts and rigs
toward a written brief.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the crown, gate, and beacon cycling on their auto-play
animations, and a reviewer judges it against the brief: that it reads as a
fortified keep, the crown rotates, gate raises, and beacon spins on the correct
axes without detaching, the keep base stays fixed, and only the moving parts
move.
