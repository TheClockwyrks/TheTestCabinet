**Sunfront Flakhound** is a four-legged Duneforged anti-air walker with a
traversing back turret and twin elevating flak barrels. This asset-generation case
asks a model to sculpt *and rig* it as a 52×48×56 opaque-voxel model using only the
`voxel-anim` tool, one recorded operation at a time: instead of a mesh it **paints
discrete opaque cells** — setting and clearing voxels, filling and stroking boxes,
drawing lines and spheres — to build up a squat brass armored body carried on legs,
an iron turret up on its back, and a pair of flak barrels raked toward the sky.
Crucially, the case does **not** hand the model a rig: it fixes only the two
animations the model must author — a leg-striding **`walk`** and a weapon-tracking
**`flak_track`** — and leaves the parts, joints, and articulation that realize them
entirely to the model, so the test measures whether a model can work out the pieces a
walking, target-tracking anti-air platform needs, attach them where they belong, and
animate them convincingly (legs that plant a flat foot and push the body forward, a
turret that traverses onto a bearing, and barrels that elevate to track the sky).
There is no target model — the model sculpts, rigs, and animates toward a written
brief, and may add its own extra parts, joints, and animations on top. The recorded
per-part operations are regenerated into a rigged, animated 3D model the frontend
renders with the play-back `walk` and `flak_track` animations, and a reviewer judges
it against the brief: that it reads as a four-legged anti-air walker, the legs stride
on planted feet without clipping the ground, the turret traverses and the barrels
elevate without detaching, and the body stays put while only the moving parts move.
