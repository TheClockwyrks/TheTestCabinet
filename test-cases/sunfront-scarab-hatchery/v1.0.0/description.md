**Sunfront Scarab Hatchery** is a squat, wide Duneforged hive-mound clustered with
amber-glowing hatch cells.

This asset-generation case asks a model to sculpt *and rig* it as a 56×40×56
opaque-voxel model using only the `voxel-anim` tool, one recorded operation at a
time: a low brass hive-mound, a central iris hatch crowning it, and an exhaust
vent set into its side. Crucially, the case does **not** hand the model a rig: it
fixes only the two self-playing animations the model must author, and leaves the
parts, joints, and articulation that realize them entirely to the model. Those two
are **`hatch_turn`**, which turns the central iris hatch continuously about its
vertical axis, and **`vent_bob`**, which lifts the side vent off its seat and
settles it back. Both animations play on their own, continuously, so the hatchery
cycles with no caller while the mound stays put.

So the test measures whether a model can work out the pieces a living hive-mound
needs, attach them where they belong, and animate them convincingly. There is no
target model: the model sculpts and rigs toward a written brief, and may add its
own extra parts and animations on top.

The recorded per-part operations are regenerated into a rigged 3D model the
frontend renders with the hatch and vent cycling on their decorative auto-play
animations, and a reviewer judges it against the brief: that it reads as a
hive-mound hatchery, the hatch turns and vent bobs on their own without detaching,
the mound body stays fixed, and only the moving elements move.
